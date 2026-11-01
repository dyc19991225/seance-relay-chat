<!-- Draft written outside Kiro as a starting point; refine it in Kiro (e.g. "Analyze Requirements"). -->
# Requirements: Ghost, the AI channel assistant

## Introduction
Ghost is a bot user that sits in the default channels and answers questions and
summarizes conversations using an OpenAI-compatible chat completions API with
the operator's own official API key. A mock provider allows full use without a key.
Bring your own official API keys; not a proxy for consumer subscriptions.

## Requirement 1: Commands
**User story:** As a channel member, I want to ask the Ghost things in the channel, so that everyone sees the answer.

#### Acceptance criteria
1. WHEN a channel PRIVMSG starts with `!ask <question>`
   THE SYSTEM SHALL answer the question in the channel, addressed to the asker.
2. WHEN a channel PRIVMSG is `!summary` or `!summary <n>`
   THE SYSTEM SHALL summarize the last n channel lines (default 50, clamped to 5..200).
3. WHEN a channel PRIVMSG is `!tldr`
   THE SYSTEM SHALL reply with a one-line summary of the last 30 lines.
4. WHEN a channel PRIVMSG starts with `Ghost:`, `Ghost,` or contains `@Ghost`
   THE SYSTEM SHALL treat the rest as a question.
5. WHEN a channel line merely contains the word "ghost" without addressing the bot
   THE SYSTEM SHALL not reply.
6. WHEN a user sends a private PRIVMSG to Ghost
   THE SYSTEM SHALL treat the whole text as a question and reply privately.
7. WHEN Ghost receives a NOTICE
   THE SYSTEM SHALL never reply (RFC 2812 3.3.2).
8. WHEN a channel PRIVMSG is `!help`
   THE SYSTEM SHALL list the commands and the active provider name.

## Requirement 2: Output and ordering
#### Acceptance criteria
1. WHEN Ghost replies
   THE SYSTEM SHALL deliver the reply after the triggering message to every member.
2. WHEN the model output is long or multi-line
   THE SYSTEM SHALL split it into at most `GHOST_MAX_LINES` IRC lines of at most 400 bytes each.
3. WHEN the model returns an empty answer
   THE SYSTEM SHALL reply "(the spirits are silent)".

## Requirement 3: Limits and failures
#### Acceptance criteria
1. WHEN the same nick triggers Ghost again within `GHOST_COOLDOWN_MS`
   THE SYSTEM SHALL send that nick a NOTICE with the remaining wait time and not call the model.
2. WHEN `GHOST_MAX_CONCURRENT` calls are already in flight
   THE SYSTEM SHALL send a busy NOTICE and not call the model.
3. WHEN the provider fails or times out after `AI_TIMEOUT_MS`
   THE SYSTEM SHALL post a short error line in the channel and log only the error status, never the key or the response body.

## Requirement 4: Providers and prompt safety
#### Acceptance criteria
1. WHEN `AI_PROVIDER` is unset and `AI_API_KEY` is empty
   THE SYSTEM SHALL use the mock provider.
2. WHEN `AI_PROVIDER` is unset and `AI_API_KEY` is set, or `AI_PROVIDER=openai`
   THE SYSTEM SHALL POST to `{AI_BASE_URL}/chat/completions` with `AI_MODEL` and a Bearer key.
3. WHEN the mock provider answers
   THE SYSTEM SHALL prefix the reply with "[mock]" and return deterministic text.
4. WHEN channel history is sent to the model
   THE SYSTEM SHALL strip IRC formatting codes, label the transcript as untrusted, and exclude bot lines and earlier `!summary`, `!tldr` and `!help` commands.
