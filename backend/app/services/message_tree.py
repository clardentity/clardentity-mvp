"""The active branch of a conversation - forking's replacement for a flat
message list.

Every message has a `parent_id`; a conversation points at the leaf of the
path currently shown (`active_leaf_id`). Editing or regenerating never
deletes a row - it adds a sibling and moves the leaf pointer - so "the
conversation" a user sees is the path from that leaf back to the root, not
every row with this conversation_id (which now includes abandoned branches
too).

Pure functions over an already-fetched message list, not queries: a
conversation's message count is small enough that one query for everything
plus an in-memory walk is simpler and just as fast as a recursive CTE, and it
keeps this module trivially unit-testable without a database.
"""

import uuid

from app.models import Message


def active_path(messages: list[Message], leaf_id: uuid.UUID | None) -> list[Message]:
    """Root-to-leaf order. `messages` must be every row for the conversation
    the leaf belongs to."""
    if leaf_id is None:
        return []
    by_id = {m.id: m for m in messages}
    chain: list[Message] = []
    seen: set[uuid.UUID] = set()
    current_id: uuid.UUID | None = leaf_id
    while current_id is not None and current_id not in seen:
        msg = by_id.get(current_id)
        if msg is None:
            break
        seen.add(current_id)
        chain.append(msg)
        current_id = msg.parent_id
    chain.reverse()
    return chain


def siblings(messages: list[Message], of: Message) -> list[Message]:
    """Every message sharing `of`'s parent (or every root message of the same
    conversation, if it has none), oldest first - the branches selectable at
    this exact point in the conversation."""
    group = [
        m
        for m in messages
        if m.conversation_id == of.conversation_id and m.parent_id == of.parent_id
    ]
    group.sort(key=lambda m: m.created_at)
    return group


def resolve_parent_id(
    fields_set: set[str],
    requested_parent_id: uuid.UUID | None,
    active_leaf_id: uuid.UUID | None,
) -> uuid.UUID | None:
    """Where a new message attaches: the client's explicit override if it
    sent one, otherwise wherever the conversation currently is.

    Checked via `fields_set` (a request payload's `model_fields_set`), not by
    testing `requested_parent_id is not None`: editing the very first message
    of a conversation - whose real parent is null - sends an explicit
    parent_id of None, which is a legitimate override to root, not "no
    override given". Collapsing the two onto the same None silently
    reattached that edit under wherever the conversation currently was,
    instead of starting the new root sibling it was supposed to.
    """
    if "parent_id" in fields_set:
        return requested_parent_id
    return active_leaf_id


def descendants(messages: list[Message], from_id: uuid.UUID) -> list[Message]:
    """Every message in the subtree rooted at `from_id`, not including
    `from_id` itself - the forward mirror of `active_path`'s backward walk.

    Used to know what a delete is about to take down before it happens - the
    DB's `ON DELETE CASCADE` on `parent_id` does the actual deletion; this is
    only for deciding what `active_leaf_id` needs to move to if it was
    pointing somewhere in the doomed subtree."""
    by_parent: dict[uuid.UUID | None, list[Message]] = {}
    for m in messages:
        by_parent.setdefault(m.parent_id, []).append(m)

    result: list[Message] = []
    frontier = [from_id]
    while frontier:
        next_frontier: list[uuid.UUID] = []
        for node_id in frontier:
            children = by_parent.get(node_id, [])
            result.extend(children)
            next_frontier.extend(c.id for c in children)
        frontier = next_frontier
    return result


def latest_leaf(messages: list[Message], from_id: uuid.UUID) -> uuid.UUID:
    """Descend from `from_id`, always taking the most recently created child,
    until there are none. What switching to a branch lands on: each fork
    reopens wherever it last left off, without remembering a separate
    preference per node along the way."""
    by_parent: dict[uuid.UUID | None, list[Message]] = {}
    for m in messages:
        by_parent.setdefault(m.parent_id, []).append(m)

    current = from_id
    while True:
        children = by_parent.get(current)
        if not children:
            return current
        current = max(children, key=lambda m: m.created_at).id
