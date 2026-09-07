import uuid
from datetime import datetime, timedelta

from app.services.message_tree import (
    active_path,
    descendants,
    latest_leaf,
    resolve_parent_id,
    siblings,
)


def make(conv_id, parent_id, created_offset, role="user"):
    return type(
        "M",
        (),
        {
            "id": uuid.uuid4(),
            "conversation_id": conv_id,
            "parent_id": parent_id,
            "created_at": datetime(2026, 1, 1) + timedelta(seconds=created_offset),
            "role": role,
        },
    )()


class TestActivePath:
    def test_empty_when_leaf_is_none(self):
        assert active_path([make(1, None, 0)], None) == []

    def test_walks_a_straight_line_root_to_leaf(self):
        conv = uuid.uuid4()
        a = make(conv, None, 0)
        b = make(conv, a.id, 1)
        c = make(conv, b.id, 2)
        assert active_path([a, b, c], c.id) == [a, b, c]

    def test_stops_before_an_abandoned_branch(self):
        conv = uuid.uuid4()
        a = make(conv, None, 0)
        old_answer = make(conv, a.id, 1)
        new_answer = make(conv, a.id, 2)  # sibling of old_answer, same parent
        # Active leaf points at the new branch - old_answer must not appear.
        path = active_path([a, old_answer, new_answer], new_answer.id)
        assert path == [a, new_answer]
        assert old_answer not in path

    def test_a_dangling_leaf_id_returns_what_it_can_walk(self):
        # Defensive: a leaf_id from a message that no longer exists in the
        # supplied list shouldn't crash the walk.
        assert active_path([], uuid.uuid4()) == []


class TestSiblings:
    def test_root_messages_are_siblings_of_each_other(self):
        conv = uuid.uuid4()
        a = make(conv, None, 0)
        b = make(conv, None, 1)  # an edited first message
        other_conv_root = make(uuid.uuid4(), None, 0)
        result = siblings([a, b, other_conv_root], a)
        assert result == [a, b]

    def test_messages_under_a_different_parent_are_excluded(self):
        conv = uuid.uuid4()
        parent1 = make(conv, None, 0)
        parent2 = make(conv, None, 1)
        child1 = make(conv, parent1.id, 2)
        child2 = make(conv, parent2.id, 3)
        assert siblings([parent1, parent2, child1, child2], child1) == [child1]

    def test_ordered_oldest_first_regardless_of_input_order(self):
        conv = uuid.uuid4()
        parent = make(conv, None, 0)
        first = make(conv, parent.id, 1)
        second = make(conv, parent.id, 2)
        assert siblings([second, first], first) == [first, second]


class TestLatestLeaf:
    def test_a_leaf_with_no_children_returns_itself(self):
        a = make(uuid.uuid4(), None, 0)
        assert latest_leaf([a], a.id) == a.id

    def test_descends_to_the_most_recently_created_grandchild(self):
        conv = uuid.uuid4()
        root = make(conv, None, 0)
        child_old = make(conv, root.id, 1)
        child_new = make(conv, root.id, 2)
        grandchild = make(conv, child_new.id, 3)
        result = latest_leaf([root, child_old, child_new, grandchild], root.id)
        assert result == grandchild.id

    def test_ignores_created_at_order_of_the_input_list(self):
        conv = uuid.uuid4()
        root = make(conv, None, 0)
        older = make(conv, root.id, 1)
        newer = make(conv, root.id, 5)
        # Passed in reverse of creation order - the function must sort by
        # created_at itself, not trust list order.
        assert latest_leaf([newer, older, root], root.id) == newer.id


class TestDescendants:
    def test_a_leaf_with_no_children_has_none(self):
        a = make(uuid.uuid4(), None, 0)
        assert descendants([a], a.id) == []

    def test_collects_the_whole_subtree_not_just_direct_children(self):
        conv = uuid.uuid4()
        root = make(conv, None, 0)
        child = make(conv, root.id, 1)
        grandchild = make(conv, child.id, 2)
        result = descendants([root, child, grandchild], root.id)
        assert set(result) == {child, grandchild}

    def test_does_not_include_the_node_itself(self):
        conv = uuid.uuid4()
        root = make(conv, None, 0)
        child = make(conv, root.id, 1)
        assert root not in descendants([root, child], root.id)

    def test_sibling_branches_are_excluded(self):
        # Deleting one branch must never sweep up an unrelated fork at the
        # same level - only what's actually underneath the target.
        conv = uuid.uuid4()
        root = make(conv, None, 0)
        target = make(conv, root.id, 1)
        sibling = make(conv, root.id, 2)
        target_child = make(conv, target.id, 3)
        sibling_child = make(conv, sibling.id, 4)
        result = descendants([root, target, sibling, target_child, sibling_child], target.id)
        assert set(result) == {target_child}


class TestResolveParentId:
    def test_no_override_continues_from_the_active_leaf(self):
        leaf = uuid.uuid4()
        assert resolve_parent_id(set(), None, leaf) == leaf

    def test_an_explicit_override_wins_over_the_active_leaf(self):
        leaf = uuid.uuid4()
        override = uuid.uuid4()
        assert resolve_parent_id({"parent_id"}, override, leaf) == override

    def test_an_explicit_override_to_root_is_not_mistaken_for_no_override(self):
        # Editing the very first message of a conversation sends parent_id:
        # null on purpose (its real parent is root) - this must NOT fall
        # back to the active leaf just because the value happens to be None.
        leaf = uuid.uuid4()
        assert resolve_parent_id({"parent_id"}, None, leaf) is None
