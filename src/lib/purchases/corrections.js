import { TABS, appendRow } from './sheets.js';

export async function recordCorrection({
  company_id,
  purchase_id,
  supplier_key,
  original_category,
  original_classified_by,
  corrected_category,
  corrected_by,
}) {
  await appendRow(TABS.corrections, {
    company_id,
    purchase_id,
    supplier_key,
    original_category: original_category || '',
    original_classified_by: original_classified_by || '',
    corrected_category,
    corrected_at: new Date().toISOString(),
    corrected_by: corrected_by || '',
  });
}
