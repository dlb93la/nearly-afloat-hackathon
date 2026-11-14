export const ACCOUNT_CHOICE_KEY = 'afloat-choose-account';

// A deliberate game sign-out must not silently restore the provider's old user
// on the next login. OAuth callbacks, however, already represent a fresh choice.
export async function resolveLoginChoice({ user, chooseAccount, oauthReturned, logout, clearChoice }) {
  if (!chooseAccount || oauthReturned) return user;
  if (user) await logout(user.id);
  clearChoice();
  return null;
}
