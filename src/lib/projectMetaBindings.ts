export function getProjectMetaBindingChanges(selectedIds: string[], savedIds: string[]) {
  const nextIds = [...new Set(selectedIds)];
  const savedIdSet = new Set(savedIds);
  const nextIdSet = new Set(nextIds);

  return {
    nextIds,
    idsToAdd: nextIds.filter((id) => !savedIdSet.has(id)),
    idsToRemove: [...new Set(savedIds)].filter((id) => !nextIdSet.has(id)),
  };
}
