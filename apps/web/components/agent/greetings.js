import { PERMISSIONS, can } from "@synergifund/shared"

// The greeting a new Agent chat opens with, on the Agent page and on the phone: a hello on the first line and a
// question on the second, each picked at random for every new chat. A hello with `hours` is only picked at that time of
// day (from, to on a 24-hour clock; evening runs past midnight). Add or change them here. {name} is the first name.
export const HELLOS = [
  { text: "Good morning, {name}", hours: [5, 12] },
  { text: "Good afternoon, {name}", hours: [12, 17] },
  { text: "Good evening, {name}", hours: [17, 29] },
  { text: "Hi {name}," },
  { text: "Hi {name}," },
]
export const ASKS = ["How can I help you?", "What are we working on?", "What's on your mind?", "What can I look up for you?"]

// Under the greeting: what people often ask, to start with a tap. `send` asks it at once; the rest go in the box to
// finish (a task needs saying what it is). `needs`: the permission it takes. The first three that fit are shown.
export const SUGGESTIONS = [
  { text: "What's on my plate this week?", send: true },
  { text: "Which houses are under contract?", send: true, needs: PERMISSIONS.propertiesRead },
  { text: "Create a task", fill: "Create a task: ", needs: PERMISSIONS.tasksEdit },
  { text: "Summarize a property", fill: "Summarize the property at ", needs: PERMISSIONS.propertiesRead },
]

function fits(hello, hour) {
  if (!hello.hours) return true
  const [from, to] = hello.hours
  const clock = hour < 5 ? hour + 24 : hour
  return clock >= from && clock < to
}

export function pickGreeting(name, hour = new Date().getHours(), random = Math.random) {
  const hellos = HELLOS.filter((hello) => fits(hello, hour))
  return {
    hello: hellos[Math.floor(random() * hellos.length)].text.replace("{name}", name),
    ask: ASKS[Math.floor(random() * ASKS.length)],
  }
}

export function suggestionsFor(user) {
  return SUGGESTIONS.filter((item) => !item.needs || (user && can(user, item.needs))).slice(0, 3)
}
