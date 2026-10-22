"use client"

import { useState } from "react"
import { useApi } from "../../lib/useApi"
import { dollars } from "../../lib/format"
import { ReceiptSheet } from "./ReceiptSheet"

// "Add a receipt" from a property page: the receipt starts on this property (one more tap to split it).
export function AddReceipt({ propertyId, label = "Add a receipt", className = "primary", onFiled }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState("")
  const properties = useApi(open ? "/properties" : null)
  const receipts = useApi(open ? "/receipts" : null)
  const ready = properties.data && receipts.data
  return (
    <>
      <button type="button" className={className} onClick={() => { setMessage(""); setOpen(true) }}>{label}</button>
      {message && <p className="settings-note receipt-filed">{message}</p>}
      {open && ready && (
        <ReceiptSheet
          properties={(properties.data.items || []).map((property) => ({ id: property.id, address: property.address }))}
          buyers={receipts.data.buyers || []}
          posts={Boolean(receipts.data.posts)}
          readingAvailable={receipts.data.readingAvailable !== false}
          defaultPropertyId={propertyId}
          onClose={() => setOpen(false)}
          onFiled={(result) => {
            setOpen(false)
            setMessage(`${result.posted ? "Posted to" : "Sent for approval on"} ${result.filed.map((part) => `${part.address} (${dollars(part.totalCents / 100)})`).join(" and ")}.`)
            onFiled?.(result)
          }}
        />
      )}
      {open && !ready && (properties.error || receipts.error) && <p className="banner">{properties.error || receipts.error}</p>}
    </>
  )
}
