"use client"

import { useState } from "react"

// A password field with a Show / Hide switch.
export function PasswordInput(props) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="password-input">
      <input {...props} type={visible ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </span>
  )
}
