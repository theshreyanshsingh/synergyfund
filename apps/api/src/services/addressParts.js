import { fullAddress, splitCity } from "@synergifund/shared"
import { Property } from "../models/index.js"
import { censusAddress } from "./geocode.js"

// Properties were entered with a street and a city only, so their state and ZIP are filled in from the address: from
// the city text when it already has them ("Jacksonville, FL 32207" becomes Jacksonville, FL, 32207), otherwise from
// the US Census address lookup. Only blank fields are filled, and a lookup is used only when its city is the
// property's city. An address the lookup does not know is remembered (addressChecked), so it is not looked up again
// until the address changes.

const letters = (text) => String(text || "").toLowerCase().replace(/[^a-z]/g, "")
const titleCase = (text) => String(text || "").toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())

export function needsAddressParts(property) {
  return Boolean(String(property.address || "").trim()) && (!property.state || !property.zip) && property.addressChecked !== fullAddress(property)
}

// The fields to set on the property (empty when there is nothing to fill).
export async function addressParts(property) {
  const set = {}
  const typed = splitCity(property.city)
  if (typed) {
    set.city = typed.city
    if (!property.state) set.state = typed.state
    if (!property.zip && typed.zip) set.zip = typed.zip
  }
  const city = typed ? typed.city : String(property.city || "").trim()
  const state = property.state || set.state || ""
  const zip = property.zip || set.zip || ""
  if (!state || !zip) {
    const match = await censusAddress(fullAddress({ address: property.address, city, state, zip }))
    if (match === undefined) return set
    if (match && (city ? letters(match.city) === letters(city) : Boolean(match.city)) && (!state || match.state === state)) {
      if (!city) set.city = titleCase(match.city)
      if (!state && match.state) set.state = match.state
      if (!zip && match.zip) set.zip = match.zip
      if (property.lat == null && match.lat != null && match.lng != null) Object.assign(set, { lat: match.lat, lng: match.lng })
    }
    const after = { ...property, ...set }
    if (!after.state || !after.zip) set.addressChecked = fullAddress(after)
  }
  return set
}

// Fills one property's state and ZIP, unless someone changed its address in the meantime. Returns what was set.
export async function fillAddressParts(property) {
  const source = property.toObject ? property.toObject() : property
  if (!needsAddressParts(source)) return {}
  const set = await addressParts(source)
  if (!Object.keys(set).length) return {}
  const same = (value) => (value ? value : { $in: [null, ""] })
  const result = await Property.updateOne({ _id: source._id, address: source.address, city: same(source.city), state: same(source.state), zip: same(source.zip) }, { $set: set }, { timestamps: false })
  return result.matchedCount ? set : {}
}
