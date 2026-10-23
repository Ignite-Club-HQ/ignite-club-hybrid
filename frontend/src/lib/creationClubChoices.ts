/** Theme scope narrows choices; a missing scoped club never reveals others. */
export function creationClubChoices<T extends { id: string }>(clubs: T[] | undefined, themeClubId: string | null | undefined): T[] | undefined {
  return themeClubId ? clubs?.filter((club) => club.id === themeClubId) : clubs;
}