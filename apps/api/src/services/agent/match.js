const ABBREVIATIONS = {
  st: "street",
  ave: "avenue",
  av: "avenue",
  rd: "road",
  dr: "drive",
  ln: "lane",
  blvd: "boulevard",
  ct: "court",
  pl: "place",
  ter: "terrace",
  hwy: "highway",
  pkwy: "parkway",
  cir: "circle",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  apt: "unit",
  fl: "florida",
  jax: "jacksonville",
  fll: "fort lauderdale",
}

export function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .flatMap((word) => (ABBREVIATIONS[word] ? ABBREVIATIONS[word].split(" ") : [word]))
}

function distance(left, right) {
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost)
    }
    previous = current
  }
  return previous[right.length]
}

function jaroWinkler(left, right) {
  const window = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1)
  const leftHits = new Array(left.length).fill(false)
  const rightHits = new Array(right.length).fill(false)
  let matches = 0
  for (let index = 0; index < left.length; index += 1) {
    const from = Math.max(0, index - window)
    const to = Math.min(right.length - 1, index + window)
    for (let other = from; other <= to; other += 1) {
      if (rightHits[other] || left[index] !== right[other]) continue
      leftHits[index] = true
      rightHits[other] = true
      matches += 1
      break
    }
  }
  if (!matches) return 0
  let transpositions = 0
  let other = 0
  for (let index = 0; index < left.length; index += 1) {
    if (!leftHits[index]) continue
    while (!rightHits[other]) other += 1
    if (left[index] !== right[other]) transpositions += 1
    other += 1
  }
  const jaro = (matches / left.length + matches / right.length + (matches - transpositions / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && left[prefix] && left[prefix] === right[prefix]) prefix += 1
  return jaro + prefix * 0.1 * (1 - jaro)
}

function wordSimilarity(query, word) {
  if (query === word) return 1
  if (/^\d+$/.test(query) || /^\d+$/.test(word)) return word.startsWith(query) ? 0.9 : 0
  if (word.startsWith(query) && query.length >= 3) return 0.92
  if (query.length < 4 || word.length < 4) return 0
  const longest = Math.max(query.length, word.length)
  return Math.max(1 - distance(query, word) / longest, jaroWinkler(query, word) - 0.05)
}

export function matchScore(query, text) {
  const wanted = tokens(query)
  const words = tokens(text)
  if (!wanted.length || !words.length) return 0
  const phrase = String(text || "").toLowerCase().includes(String(query || "").toLowerCase().trim()) ? 0.1 : 0
  const total = wanted.reduce((sum, item) => sum + Math.max(...words.map((word) => wordSimilarity(item, word))), 0)
  return Math.min(1, total / wanted.length + phrase)
}

export function rank(items, query, textOf, threshold = 0.78) {
  return items
    .map((item) => ({ item, score: matchScore(query, textOf(item)) }))
    .filter((entry) => entry.score >= threshold)
    .sort((left, right) => right.score - left.score)
}
