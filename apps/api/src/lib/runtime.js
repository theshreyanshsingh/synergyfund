// `npm run dev`: SF_DEV=1 from its script, or Node's watch mode (which sets WATCH_REPORT_DEPENDENCIES in the process it
// runs). Often a computer pointed at the live data, so the jobs that act on their own (the document reader, repeating
// prompts) leave the work to the server there unless asked.
export function devServer() {
  return process.env.SF_DEV === "1" || Boolean(process.env.WATCH_REPORT_DEPENDENCIES)
}
