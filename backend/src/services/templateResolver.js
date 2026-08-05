import { normalizeAppearanceId } from '../../../shared/layout-formats.js';

const clientTemplateMap = {
  default: '2',
};

export const resolveTemplateId = ({ templateId, clientName }) => {
  if (templateId) return normalizeAppearanceId(templateId, '2');
  if (clientName && clientTemplateMap[clientName]) {
    return normalizeAppearanceId(clientTemplateMap[clientName], '2');
  }
  return clientTemplateMap.default;
};

export const getTemplateMap = () => ({ ...clientTemplateMap });
