export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

export function sendError(res, status, error) {
  res.status(status).json({ error })
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.permissions.includes(permission)) {
      sendError(res, 403, "You do not have permission for that action.")
      return
    }
    next()
  }
}

export function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!permissions.some((permission) => req.permissions.includes(permission))) {
      sendError(res, 403, "You do not have permission for that action.")
      return
    }
    next()
  }
}
