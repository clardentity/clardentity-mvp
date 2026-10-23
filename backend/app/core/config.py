from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # OpenAI
    openai_api_key: str
    # Measured against this account on 2026-08-10, streaming the same prompt:
    #   gpt-5                        6.87s to first token,  7.80s total
    #   gpt-5-mini    (low effort)   1.95s to first token,  4.73s total
    #   gpt-5.4-mini  (low effort)   0.98s to first token,  1.91s total
    # gpt-5 spends most of that budget reasoning before emitting anything,
    # which is the worst possible shape for a streaming chat UI - the user
    # watches a blank box for seven seconds and concludes streaming is broken.
    openai_model: str = "gpt-5.4-mini"
    # Classification, query rewriting, verification, supervision. Each is a
    # short structured judgement, none of them is the answer, and all of them
    # sit between the user and something they're waiting for.
    openai_fast_model: str = "gpt-5.4-nano"
    # gpt-5 family are reasoning models; effort is the single biggest lever on
    # latency. "low" still reasons, it just doesn't deliberate.
    openai_reasoning_effort: str = "low"
    openai_embedding_model: str = "text-embedding-3-small"

    # Claude powers everything the product reasons with. OpenAI is retained
    # above only for embeddings, transcription, speech and the realtime call -
    # Anthropic has no equivalent of any of those.
    anthropic_api_key: str = ""

    # Tavily - a search API proper, for grounding and per-claim verification.
    # Returns ranked results with page excerpts in 1-3s, where asking a model
    # to search through its own tool took 5-20s a round. Optional: with no
    # key, web_research falls back to the model's search tool.
    tavily_api_key: str | None = None

    # PostHog's query API, read by the admin panel's analytics (see
    # services/posthog_analytics). The project's publishable key (phc_) lives
    # in the frontend build; this one is a personal API key with Query: Read
    # on that one project, and a real secret - Render env only. With either
    # unset the panel says analytics is not connected and nothing else
    # changes. EU, because the privacy policy says that is where it lives.
    posthog_api_host: str = "https://eu.posthog.com"
    posthog_project_id: str | None = None
    posthog_query_key: str | None = None
    anthropic_model: str = "claude-opus-5"
    # Auxiliary judgements (guidance, clarifier, verification, reviews) run on
    # this one. Every one of them sits between the user and something they are
    # waiting for - the mode and context gates block the answer outright - so
    # the tier is chosen for latency, on the owner's instruction rather than as
    # a cost saving taken unilaterally. The streamed answer itself stays on the
    # model above.
    anthropic_fast_model: str = "claude-sonnet-5"
    # The quick answer: a few unchecked sentences, where time to first token
    # is the whole product. Haiku is the fastest thing in the family.
    anthropic_rapid_model: str = "claude-haiku-4-5-20251001"
    # Modes whose answers are generated on the fast model rather than the
    # flagship. Measured 2026-09-16: the flagship spent ~10s writing an
    # 11-claim Knowing answer; the fast model does it in ~4s, and Knowing's
    # quality gate is the verification that follows, not the generator's
    # deliberation. Decision joins them: its verdict box is a separate call,
    # and the flagship spent 17s writing a three-operator comparison body.
    # Thinking, Guidance and Healthcare stay on the flagship. Comma-separated,
    # env-overridable.
    fast_generation_modes: str = "knowing,learning,creative,decision,legal"
    # The companions a paid tier would open. Locked in the picker; a signed-in
    # user can open them for testing from the plans dialog, capped per day.
    # How many Postgres connections one container may hold. Multiplied by
    # every running instance: the pooler in front of Supabase caps total
    # client connections (a couple of hundred on the smaller plans), so the
    # default SQLAlchemy pool of 5 + 10 overflow is 15 per container and puts
    # the ceiling at a dozen or so instances before new ones start failing to
    # connect. Kept small deliberately - a request holds a connection for the
    # length of a query, not the length of an answer - and tunable from the
    # dashboard if the database plan grows.
    db_pool_size: int = 3
    db_max_overflow: int = 2
    # The version of the terms and privacy notice currently in force. Bump it
    # when either document changes materially; stored against each account at
    # sign-up so a later revision knows who has agreed to what.
    terms_version: str = "2026-10-23"
    # Who may open /admin. Comma-separated emails; empty means nobody, which
    # is the right default for a deployment that never sets it.
    admin_emails: str = "admin@clardentity.ai"
    # Seeded at boot when the account does not exist, so a fresh deployment
    # has an administrator without anyone running SQL by hand. Change the
    # password from the dashboard and restart to rotate it; the seed never
    # overwrites an existing account's password.
    admin_bootstrap_email: str = "admin@clardentity.ai"
    admin_bootstrap_password: str = ""
    preview_modes: str = "guidance,healthcare,creative,legal"

    #: The landing page's try-it-here box, which anyone can use without an
    #: account. The per-visitor allowance is the product rule (5,000 tokens,
    #: in services/guest_demo.py); this is the cost ceiling underneath it.
    #:
    #: It exists because the per-visitor and per-address counters are both
    #: keyed on things the caller controls - a browser-generated session id
    #: and an X-Forwarded-For header - so neither survives someone who means
    #: it. This one is keyed on nothing: it is the total the demo may spend
    #: in a day, across every visitor, after which it says "come back
    #: tomorrow" instead of generating. Raise it when the landing page is
    #: converting and the bill is understood.
    guest_daily_token_budget: int = 2_000_000

    #: Co-Creative's image model. Settings rather than constants because the
    #: catalogue moves: the first version of this feature shipped on
    #: gpt-image-1 because that name was guessed rather than looked up, and
    #: the account already had six newer ones - the current default is both
    #: better and roughly five times faster (12s against 59s).
    #:
    #: `gpt-image-2.5-flare` is the same generation and ~4s quicker at
    #: marginally less detail; swap the env var to try it.
    image_model: str = "gpt-image-2.5-sunburst"
    #: Square, so the space reserved while it generates matches what lands in
    #: it. "1536x1024" gives a nicer landscape for scenes but needs the card's
    #: aspect ratio changed to match or the answer jumps when it arrives.
    image_size: str = "1024x1024"

    #: Extra providers for the model picker in Co-Creative. Both
    #: are optional: a model whose provider has no key is hidden from the
    #: picker rather than offered and then failing when chosen.
    google_api_key: str = ""
    xai_api_key: str = ""
    #: The vendor ids behind the picker's Google and xAI entries. Settings
    #: rather than constants because these two were wired up before their keys
    #: existed - if a name is wrong, it is an env var rather than a deploy.
    #:
    #: Both Google ids were wrong, which is the whole reason for that design.
    #: Listed against the real account on 2026-10-08: "gemini-3-pro" and
    #: "gemini-3-flash" are both 404 - neither has ever existed. The account
    #: has gemini-3.1-pro-preview, gemini-3.5-flash through 3.8-flash,
    #: gemini-{pro,flash}-latest, and the 2.5 family. Guessing a vendor id is
    #: a coin flip; `GET /v1beta/models` costs nothing.
    #:
    #: This sat blank for a few hours, which is how `available()` learned to
    #: hide an entry whose vendor id is empty. The first Google key was on
    #: the free tier, where every pro model is capped at "limit: 0" and
    #: gemini-2.5-pro 404s as "no longer available to new users" - so the
    #: picker offered a Gemini Pro that could only ever answer 429. A key on
    #: a billed project reaches it in 8.5s, so it is back.
    google_model: str = "gemini-3.1-pro-preview"
    #: 3.8 is newer, but on this key 3.8 and 3.7 answered with 503 "high
    #: demand" or timed out while 3.5 answered every time. That is a free-tier
    #: symptom rather than a property of the model, so this is worth
    #: re-measuring once the account is on paid credit - the newest flash is
    #: the one we want if it is actually reachable.
    google_fast_model: str = "gemini-3.5-flash"
    #: UNVERIFIED. xAI answers permission-denied to every call, /v1/models
    #: included, while the team is out of credit, so there is no way yet to
    #: ask what this account can call. Check it the moment credit lands.
    xai_model: str = "grok-4.7"
    #: xAI speaks the OpenAI wire format, so it rides the same SDK.
    xai_base_url: str = "https://api.x.ai/v1"
    #: How hard the two thinking providers are allowed to think before they
    #: say anything. Both default to barely, for the same reason
    #: openai_reasoning_effort does: a companion that streams nothing for a
    #: minute and a half reads as broken, however good the eventual answer.
    #:
    #: Measured on the same question, one sample each. Grok 4.7 went from
    #: 105s to 3.1s (522 reasoning tokens down to 87). Gemini 3.5 Flash went
    #: from 13.0s to 3.3s. Blank or non-positive sends nothing and restores
    #: each vendor's default.
    xai_reasoning_effort: str = "low"
    google_thinking_budget: int = 128
    preview_daily_messages: int = 25
    # Depth and spend per call. "low" preserves the latency posture the
    # previous provider was tuned to; blank leaves the model's own default.
    anthropic_effort: str = "low"
    openai_stt_model: str = "whisper-1"
    openai_tts_model: str = "tts-1"
    openai_tts_voice: str = "alloy"
    # Live call. A speech-to-speech model, separate from the text pipeline
    # above: a call cannot afford a retrieve-verify-score round trip between
    # turns, so it trades the citation machinery for latency a conversation
    # can survive.
    openai_realtime_model: str = "gpt-realtime-2.1"
    openai_realtime_voice: str = "marin"

    # Database
    database_url: str

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # S3-compatible storage
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "clardentity-dev"
    s3_region: str = "us-east-1"

    # Auth
    jwt_secret: str
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 30
    google_client_id: str | None = None
    google_client_secret: str | None = None
    # The phone apps sign in with their own OAuth clients (one per platform),
    # and Google stamps a token with the client that asked for it, so a token
    # from the iOS or Android app names that client as its audience, not the
    # website's. Comma-separated; empty means only the website's ID is taken.
    google_client_ids_extra: str = ""

    # Email (Resend). Unset disables sending entirely - registration must work
    # without an email provider configured.
    resend_api_key: str | None = None
    email_from: str = "Clardentity <onboarding@resend.dev>"
    # Where the welcome email's call to action points.
    app_url: str = "http://localhost:3000"

    # Misc
    backend_cors_origins: str = "http://localhost:3000"
    max_upload_size_mb: int = 25

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]

    @property
    def google_client_ids(self) -> list[str]:
        """Every audience a Google ID token may carry here: the website's
        client first, then the apps'. Empty when Google sign-in is off - the
        extras alone do not turn it on, since the website's ID is the switch
        the rest of the deployment (and the frontend build) keys off."""
        if not self.google_client_id:
            return []
        extra = [cid.strip() for cid in self.google_client_ids_extra.split(",") if cid.strip()]
        return list(dict.fromkeys([self.google_client_id, *extra]))


settings = Settings()  # type: ignore[call-arg]
