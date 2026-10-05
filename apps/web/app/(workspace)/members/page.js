"use client"

import { useState } from "react"
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, can, initials, permissionsFor } from "@synergifund/shared"
import { PermissionPicker } from "../../../components/members/PermissionPicker"
import { StatusPill } from "../../../components/ui/StatusPill"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { useApi } from "../../../lib/useApi"

const roleLabel = Object.fromEntries(ROLES.map((role) => [role.id, role.label]))

function blankInvite(role = "member") {
  return { name: "", email: "", password: "", title: "", role, permissions: [...(ROLE_PERMISSIONS[role] || [])], propertyIds: [] }
}

export default function MembersPage() {
  const session = useSession()
  const list = useApi("/members")
  const properties = useApi("/properties")
  const people = list.data?.items || []
  const [draft, setDraft] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [issued, setIssued] = useState(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)

  function openInvite(role = "member") {
    setError("")
    setIssued(null)
    setCopied(false)
    setDraft({ mode: "invite", ...blankInvite(role) })
  }

  function openMember(row) {
    setError("")
    setIssued(null)
    setCopied(false)
    setDraft({
      mode: "edit",
      id: row.id,
      name: row.name,
      email: row.email,
      title: row.title || "",
      role: row.role,
      permissions: row.permissions || permissionsFor(row),
      propertyIds: row.propertyIds || [],
      nextPassword: "",
      locked: row.role === "admin" && !(session?.user && can(session.user, PERMISSIONS.superAdmin)),
    })
  }

  function chooseRole(role) {
    setDraft((current) => ({ ...current, role, permissions: [...(ROLE_PERMISSIONS[role] || [])], propertyIds: role === "contractor" ? current.propertyIds || [] : [] }))
  }

  function toggleProperty(id) {
    setDraft((current) => {
      const propertyIds = current.propertyIds || []
      return { ...current, propertyIds: propertyIds.includes(id) ? propertyIds.filter((item) => item !== id) : [...propertyIds, id] }
    })
  }

  async function save(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      if (draft.mode === "invite") {
        await api("/members", { method: "POST", body: draft })
        setIssued({ name: draft.name, email: draft.email, password: draft.password })
      } else {
        await api(`/members/${draft.id}`, {
          method: "PATCH",
          body: { role: draft.role, title: draft.title, permissions: draft.permissions },
        })
        if (draft.nextPassword) {
          await api(`/members/${draft.id}/password`, { method: "POST", body: { password: draft.nextPassword } })
          setIssued({ name: draft.name, email: draft.email, password: draft.nextPassword })
        }
      }
      setDraft(null)
      list.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  async function removeMember() {
    setPending(true)
    setError("")
    try {
      await api(`/members/${removing.id}`, { method: "DELETE" })
      if (draft?.id === removing.id) setDraft(null)
      setRemoving(null)
      list.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  async function copyAccess() {
    await navigator.clipboard.writeText(`SynergiFund sign-in\n${issued.email}\n${issued.password}`)
    setCopied(true)
  }

  const custom = people.filter((person) => (person.extraPermissions || []).length || (person.deniedPermissions || []).length).length
  const superAdmin = session?.user && can(session.user, PERMISSIONS.superAdmin)

  return (
    <>
      <WorkspacePage
        views={false}
        title="Members"
        secondary={{ label: "Add contractor", onClick: () => openInvite("contractor") }}
        action={{ label: "Invite member", onClick: () => openInvite("member") }}
        stats={[
          { key: "people", label: "People", value: String(people.length), hint: "In this workspace" },
          { key: "admins", label: "Admins", value: String(people.filter((person) => person.role === "admin").length), hint: "Can manage access" },
          { key: "contractors", label: "Contractors", value: String(people.filter((person) => person.role === "contractor").length), hint: "Field accounts" },
          { key: "custom", label: "Custom access", value: String(custom), hint: "Changed from the role" },
        ]}
        columns={[
          {
            key: "name",
            label: "Name",
            avatar: (row) => row.name,
            render: (row) => (
              <span className="person-copy">
                <strong>{row.name}</strong>
                <small>{row.email}</small>
              </span>
            ),
          },
          { key: "role", label: "Role", render: (row) => <StatusPill>{roleLabel[row.role] || row.role}</StatusPill> },
          {
            key: "access",
            label: "Access",
            render: (row) => (row.extraPermissions || []).length || (row.deniedPermissions || []).length
              ? <StatusPill>Custom</StatusPill>
              : <span className="muted">Role default</span>,
          },
          { key: "title", label: "Title", render: (row) => row.title || "—" },
          {
            key: "actions",
            label: "",
            pin: "right",
            render: (row) => (
              <span className="row-actions">
                <button type="button" onClick={(event) => { event.stopPropagation(); openMember(row) }}>Modify</button>
                <button type="button" className="danger" disabled={row.id === session?.user?.id} onClick={(event) => { event.stopPropagation(); setError(""); setRemoving(row) }}>Delete</button>
              </span>
            ),
          },
        ]}
        rows={people}
        important={(row) => (row.extraPermissions || []).length > 0 || (row.deniedPermissions || []).length > 0}
        onRow={openMember}
        empty={list.loading ? "Loading people…" : "Invite the first person and choose what they can do."}
      />
      {draft && (
        <div className="sheet-backdrop" onMouseDown={() => setDraft(null)}>
          <form className="member-sheet" onSubmit={save} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p>Members</p>
                <h2>{draft.mode === "invite" ? "Invite a member" : draft.name}</h2>
                <span>{draft.mode === "invite" ? "Set a password and the access they start with. They can change the password in Settings." : draft.email}</span>
              </div>
              <button type="button" className="icon-btn" onClick={() => setDraft(null)} aria-label="Close">×</button>
            </header>
            <div className="member-sheet-body">
              {error && <div className="banner">{error}</div>}
              {draft.mode !== "invite" && (
                <div className="member-id">
                  <span className="avatar lg">{initials(draft.name)}</span>
                  <span>
                    <strong>{draft.name}</strong>
                    <small>{roleLabel[draft.role]}</small>
                  </span>
                </div>
              )}
              <div className="form-grid">
                {draft.mode === "invite" && (
                  <>
                    <label className="field"><span>Name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label>
                    <label className="field"><span>Email</span><input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} required /></label>
                    <label className="field"><span>Password</span><input value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} minLength={8} required /></label>
                  </>
                )}
                <label className="field"><span>Title</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Optional" /></label>
                {draft.mode === "edit" && (
                  <label className="field"><span>New password</span><input value={draft.nextPassword} onChange={(event) => setDraft({ ...draft, nextPassword: event.target.value })} placeholder="Leave blank to keep it" /></label>
                )}
              </div>
              <div className="role-block">
                <span className="split"><span>Role</span>{draft.mode === "edit" && <button type="button" className="tool" onClick={() => chooseRole(draft.role)}>Reset to role</button>}</span>
                <div className="role-pills">
                  {ROLES.filter((role) => role.id !== "admin" || superAdmin || draft.role === "admin").map((role) => (
                    <button key={role.id} type="button" className={draft.role === role.id ? "role-pill is-on" : "role-pill"} disabled={role.id === "admin" && !superAdmin} onClick={() => { if (role.id !== "admin" || superAdmin) chooseRole(role.id) }}>
                      {role.label}
                    </button>
                  ))}
                </div>
              </div>
              {draft.role === "contractor" && (
                <div className="role-block">
                  <span>Assigned properties</span>
                  <div className="assign-list">
                    {(properties.data?.items || []).map((property) => (
                      <label key={property.id}>
                        <input type="checkbox" checked={(draft.propertyIds || []).includes(property.id)} onChange={() => toggleProperty(property.id)} />
                        {property.address}
                      </label>
                    ))}
                    {(properties.data?.items || []).length === 0 && <p className="muted">No properties yet. You can assign houses after they exist.</p>}
                  </div>
                </div>
              )}
              {draft.locked && <p className="banner">Only a super admin can change an admin.</p>}
              {draft.role === "admin" ? (
                <p className="muted">An admin can use every part of the workspace. That access is not limited.</p>
              ) : (
                <PermissionPicker role={draft.role} selected={draft.permissions} disabledIds={superAdmin ? [] : [PERMISSIONS.superAdmin]} onChange={(permissions) => setDraft({ ...draft, permissions })} />
              )}
            </div>
            <footer>
              {draft.mode === "edit" ? (
                <button type="button" className="danger" disabled={draft.id === session?.user?.id || draft.locked} onClick={() => setRemoving(draft)}>Remove</button>
              ) : <span />}
              <span className="row-actions">
                <button type="button" className="tool" onClick={() => setDraft(null)}>Cancel</button>
                <button className="primary" type="submit" disabled={pending || draft.locked}>{pending ? "Saving…" : draft.mode === "invite" ? "Create access" : "Save changes"}</button>
              </span>
            </footer>
          </form>
        </div>
      )}
      {removing && (
        <div className="sheet-backdrop" onMouseDown={() => setRemoving(null)}>
          <section className="member-sheet issued" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p>Members</p>
                <h2>Remove {removing.name}?</h2>
                <span>They will no longer be able to sign in. Properties and records stay.</span>
              </div>
              <button type="button" className="icon-btn" onClick={() => setRemoving(null)} aria-label="Close">×</button>
            </header>
            <div className="member-sheet-body">
              {error && <div className="banner">{error}</div>}
              <div className="credential">
                <span>Email</span>
                <strong>{removing.email}</strong>
                <span>Role</span>
                <strong>{roleLabel[removing.role] || removing.role}</strong>
              </div>
            </div>
            <footer>
              <button type="button" className="tool" onClick={() => setRemoving(null)}>Cancel</button>
              <button type="button" className="danger" disabled={pending} onClick={removeMember}>{pending ? "Removing…" : "Remove member"}</button>
            </footer>
          </section>
        </div>
      )}
      {issued && (
        <div className="sheet-backdrop" onMouseDown={() => setIssued(null)}>
          <section className="member-sheet issued" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p>Ready to share</p>
                <h2>{issued.name} can sign in</h2>
                <span>Send these details. They replace the password later in Settings.</span>
              </div>
              <button type="button" className="icon-btn" onClick={() => setIssued(null)} aria-label="Close">×</button>
            </header>
            <div className="member-sheet-body">
              <div className="credential">
                <span>Email</span>
                <strong>{issued.email}</strong>
                <span>Password</span>
                <strong>{issued.password}</strong>
              </div>
            </div>
            <footer>
              <button type="button" className="tool" onClick={() => setIssued(null)}>Done</button>
              <button className="primary" type="button" onClick={copyAccess}>{copied ? "Copied" : "Copy sign-in"}</button>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
