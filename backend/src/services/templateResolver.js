const clientTemplateMap = {
  default: 'theme2',
};

export const resolveTemplateId = ({ templateId, clientName }) => {
  if (templateId) return templateId;
  if (clientName && clientTemplateMap[clientName]) return clientTemplateMap[clientName];
  return clientTemplateMap.default;
};

export const getTemplateMap = () => ({ ...clientTemplateMap });
