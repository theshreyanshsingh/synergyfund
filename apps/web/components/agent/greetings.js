// The greetings a new Agent chat opens with, on the Agent page and on the phone. Each new chat picks one at random; a
// greeting with `hours` is only picked at that time of day (from, to on a 24-hour clock; evening runs past midnight).
// Add or change greetings here. {name} is the person's first name.
export const GREETINGS = [
  { text: "Good morning, {name}", hours: [5, 12] },
  { text: "Good afternoon, {name}", hours: [12, 17] },
  { text: "Good evening, {name}", hours: [17, 29] },
  { text: "What's on your mind, {name}?" },
  { text: "How can I help today, {name}?" },
  { text: "What are we working on, {name}?" },
  { text: "Back at it, {name}?" },
]

function fits(greeting, hour) {
  if (!greeting.hours) return true
  const [from, to] = greeting.hours
  const clock = hour < 5 ? hour + 24 : hour
  return clock >= from && clock < to
}

export function pickGreeting(name, hour = new Date().getHours(), random = Math.random) {
  const choices = GREETINGS.filter((greeting) => fits(greeting, hour))
  return choices[Math.floor(random() * choices.length)].text.replace("{name}", name)
}
