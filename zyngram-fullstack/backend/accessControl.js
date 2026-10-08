function hasRole(user, allowedRoles) {
  return Boolean(user && allowedRoles.includes(user.role));
}

function matchesActiveAccount(tokenUser, currentUser) {
  return Boolean(
    tokenUser && currentUser && currentUser.status === 'ACTIVE' &&
    tokenUser.id === currentUser.id && tokenUser.role === currentUser.role
  );
}

function canCaptureLocation(user, targetUserId) {
  return user?.role === 'HQ_ADMIN' || user?.id === targetUserId;
}

function canAccessFranchise(user, franchiseId) {
  return user?.role === 'HQ_ADMIN' ||
    (user?.role === 'FRANCHISE_OWNER' &&
      Array.isArray(user.franchiseIds) &&
      user.franchiseIds.includes(franchiseId));
}

function canReadCommissionOwner(user, ownerId) {
  return user?.role === 'HQ_ADMIN' ||
    (user?.role === 'FRANCHISE_OWNER' && user.id === ownerId);
}

module.exports = {
  canAccessFranchise,
  canCaptureLocation,
  canReadCommissionOwner,
  hasRole,
  matchesActiveAccount
};