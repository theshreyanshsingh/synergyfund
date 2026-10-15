import { EventEmitter } from "node:events"

// Things that happened that other parts of the server react to, without the two depending on each other.
// "chat:message" ({ channel, property, message, author }): someone posted in a conversation.
export const bus = new EventEmitter()
bus.setMaxListeners(20)
