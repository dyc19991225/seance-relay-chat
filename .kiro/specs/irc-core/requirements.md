<!-- Draft written outside Kiro as a starting point; refine it in Kiro (e.g. "Analyze Requirements"). -->
# Requirements: IRC core

## Introduction
A single-server IRC daemon that speaks the RFC 1459 / RFC 2812 client protocol
basics over plain TCP so that standard clients (irssi, HexChat, WeeChat) can
connect, register, join channels and talk. All transports share one hub.

## Requirement 1: Line protocol
**User story:** As an IRC client author, I want the server to follow the IRC line
format, so that existing clients work unchanged.

#### Acceptance criteria
1. WHEN a client sends a line terminated by CRLF or a bare LF
   THE SYSTEM SHALL parse it into an optional prefix, a command and up to 15 parameters, with an optional trailing parameter introduced by " :".
2. WHEN a received line starts with IRCv3 message tags ("@...")
   THE SYSTEM SHALL ignore the tags and process the rest of the line.
3. WHEN a client sends a line longer than 512 bytes including CRLF
   THE SYSTEM SHALL process only the first 510 bytes of it.
4. WHEN the server serializes any outgoing message
   THE SYSTEM SHALL strip CR, LF and NUL from parameters and keep the line within 512 bytes including CRLF.
5. WHEN comparing nicknames or channel names
   THE SYSTEM SHALL use RFC 1459 case mapping ("[]\~" equal "{}|^").

## Requirement 2: Registration
**User story:** As a user, I want to pick a nickname and connect, so that I can chat without an account.

#### Acceptance criteria
1. WHEN a connection has sent both a valid NICK and USER
   THE SYSTEM SHALL send numerics 001 to 005 followed by the MOTD (375, 372, 376).
2. WHEN a client sends NICK with a nickname that is already in use
   THE SYSTEM SHALL reply with 433 ERR_NICKNAMEINUSE and keep the old state.
3. WHEN a client sends NICK with an invalid nickname
   THE SYSTEM SHALL reply with 432 ERR_ERRONEUSNICKNAME.
4. WHEN an unregistered client sends any command other than NICK, USER, PASS, CAP, PING, PONG or QUIT
   THE SYSTEM SHALL reply with 451 ERR_NOTREGISTERED.
5. WHEN a client sends CAP LS
   THE SYSTEM SHALL reply with an empty capability list and not delay registration.
6. WHEN a registered client changes its nickname
   THE SYSTEM SHALL notify the client and every user sharing a channel with it exactly once.

## Requirement 3: Channels
**User story:** As a user, I want to join channels and see who is there, so that I can take part in group conversations.

#### Acceptance criteria
1. WHEN a registered client sends JOIN for a valid channel name
   THE SYSTEM SHALL broadcast the JOIN to all members and send the topic (332/333 or 331) and NAMES (353/366) to the joiner.
2. WHEN a client sends JOIN with a comma-separated list of channels
   THE SYSTEM SHALL join each channel in order.
3. WHEN a client sends PART for a channel it is in
   THE SYSTEM SHALL broadcast the PART with the optional reason and remove the member.
4. WHEN a client sends PART for a channel it is not in
   THE SYSTEM SHALL reply with 442 ERR_NOTONCHANNEL.
5. WHEN the last member leaves a channel that is not a configured default channel
   THE SYSTEM SHALL discard the channel.
6. WHEN a member sends TOPIC with a new topic
   THE SYSTEM SHALL store it with setter and time and broadcast it to all members.
7. WHEN a client sends NAMES, LIST, WHO or MODE for a channel
   THE SYSTEM SHALL answer with the matching numerics (353/366, 321/322/323, 352/315, 324).

## Requirement 4: Messaging
**User story:** As a user, I want to send messages to channels and people, so that I can talk.

#### Acceptance criteria
1. WHEN a member sends PRIVMSG to a channel
   THE SYSTEM SHALL deliver it to every other member of that channel and not echo it to the sender.
2. WHEN a client sends PRIVMSG to a channel it has not joined
   THE SYSTEM SHALL reply with 404 ERR_CANNOTSENDTOCHAN.
3. WHEN a client sends PRIVMSG to a nickname that does not exist
   THE SYSTEM SHALL reply with 401 ERR_NOSUCHNICK.
4. WHEN a client sends PRIVMSG without a recipient or without text
   THE SYSTEM SHALL reply with 411 ERR_NORECIPIENT or 412 ERR_NOTEXTTOSEND.
5. WHEN a client sends NOTICE
   THE SYSTEM SHALL deliver it like PRIVMSG but never send error replies for it.
6. WHEN a channel message, action, topic, join, part or quit happens
   THE SYSTEM SHALL record it in the history store.

## Requirement 5: Liveness and abuse limits
**User story:** As an operator, I want dead or abusive connections cleaned up, so that the server stays healthy.

#### Acceptance criteria
1. WHEN a client sends PING with a token
   THE SYSTEM SHALL reply with PONG carrying the same token.
2. WHEN a TCP client has been silent for 90 seconds
   THE SYSTEM SHALL send it a PING.
3. WHEN a TCP client has been silent for 240 seconds
   THE SYSTEM SHALL close the connection with an ERROR line.
4. WHEN a client sends PRIVMSG or NOTICE faster than the flood budget allows (burst 20, refill 2 per second)
   THE SYSTEM SHALL drop the excess messages and send the client a server NOTICE asking it to slow down.
5. WHEN a client sends QUIT
   THE SYSTEM SHALL broadcast the QUIT to users sharing a channel and send ERROR "Closing Link" before closing.
6. WHEN the server shows a user's host
   THE SYSTEM SHALL show a salted hash cloak instead of the real IP address.
