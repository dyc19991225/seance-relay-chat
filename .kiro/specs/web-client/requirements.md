<!-- Draft written outside Kiro as a starting point; refine it in Kiro (e.g. "Analyze Requirements"). -->
# Requirements: Web client and WebSocket bridge

## Introduction
A browser client that joins the same channels as real IRC clients. The browser
speaks a small JSON protocol over a WebSocket at `/ws`; the server translates it
to and from IRC messages and feeds it into the same `ChatHub`.

## Requirement 1: Bridge
**User story:** As a browser user, I want to talk with people on real IRC clients, so that nobody has to install anything to join.

#### Acceptance criteria
1. WHEN the browser sends `{"type":"hello","nick":...}`
   THE SYSTEM SHALL register it with the hub as NICK + USER and return a `welcome` event.
2. WHEN the browser sends `join`, `part`, `msg`, `action`, `notice`, `topic`, `nick`, `names`, `list` or `quit`
   THE SYSTEM SHALL translate it into the equivalent IRC command.
3. WHEN the browser sends a `raw` command
   THE SYSTEM SHALL parse the line as IRC and pass it to the hub with the same rules as a TCP client.
4. WHEN the hub sends an IRC message to a browser client
   THE SYSTEM SHALL convert it into a typed JSON event (message, join, part, quit, nick, topic, names, list, error, server).
5. WHEN the hub sends 353 replies followed by 366
   THE SYSTEM SHALL emit one `names` event containing the full member list.
6. WHEN a TCP user sends a channel PRIVMSG
   THE SYSTEM SHALL deliver it to browser members of that channel, and the reverse.

## Requirement 2: Input validation
**User story:** As an operator, I want malformed browser input rejected, so that the bridge cannot be abused.

#### Acceptance criteria
1. WHEN a WebSocket frame is larger than 8 KB
   THE SYSTEM SHALL close the connection.
2. WHEN a frame is not valid JSON, has an unknown `type`, or exceeds 4096 bytes
   THE SYSTEM SHALL reply with an `error` event and ignore it.
3. WHEN any browser-supplied string is placed into an IRC message
   THE SYSTEM SHALL replace CR, LF and NUL with spaces and clip it to a safe length.
4. WHEN `ALLOWED_ORIGINS` is set and the upgrade request has a different Origin
   THE SYSTEM SHALL refuse the upgrade with HTTP 403.

## Requirement 3: History
**User story:** As a browser user, I want to see what was said before I arrived, so that I have context.

#### Acceptance criteria
1. WHEN a browser client joins a channel and `HISTORY_ON_JOIN` is greater than 0
   THE SYSTEM SHALL send a `history` event with up to that many recent entries, oldest first.
2. WHEN history entries are shown
   THE SYSTEM SHALL mark them visually as recovered history.

## Requirement 4: User interface
**User story:** As a user, I want a retro IRC look that is easy to use, so that it feels like IRC but works for newcomers.

#### Acceptance criteria
1. WHEN the page loads
   THE SYSTEM SHALL show a nickname prompt and auto-join the default channels returned by `/api/info`.
2. WHEN the user types a line starting with `/`
   THE SYSTEM SHALL support /join, /part, /me, /msg, /nick, /topic, /names, /list, /quote and /help.
3. WHEN chat text is rendered
   THE SYSTEM SHALL insert it with `textContent` only, never as HTML.
4. WHEN several channels are auto-joined
   THE SYSTEM SHALL keep focus on the first channel; an explicit /join SHALL move focus to the new channel.
5. WHEN a message mentions the user's nick
   THE SYSTEM SHALL highlight that line.
6. WHEN a message arrives in a buffer that is not in focus
   THE SYSTEM SHALL show an unread counter next to that buffer.
7. WHEN the user prefers reduced motion
   THE SYSTEM SHALL disable the flicker animation.
8. WHEN the HTTP server serves any page
   THE SYSTEM SHALL send a Content-Security-Policy that only allows same-origin scripts, styles and WebSocket connections.
