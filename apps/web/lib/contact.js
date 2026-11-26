// The address people write to about the app (the Support page, the privacy policy and the store listings): SUPPORT_EMAIL
// on the server, else PRIVACY_CONTACT_EMAIL, else the company's contact address given to App Review.
export function supportEmail() {
  return String(process.env.SUPPORT_EMAIL || process.env.PRIVACY_CONTACT_EMAIL || "").trim() || "contact@candidpromotions.com"
}
