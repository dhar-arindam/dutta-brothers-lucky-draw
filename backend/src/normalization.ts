export const normalizeBillNumber = (value: string): string => {
  return value.trim().toUpperCase();
};

export const trimName = (value: string): string => {
  return value.trim();
};
