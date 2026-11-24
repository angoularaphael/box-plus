/**
 * Soft delete : copie la ligne dans deleted_records, pose deleted_at.
 * On ne fait plus de DELETE SQL sur les donnees metier.
 */

async function archiveAndSoftDelete(sb, { table, idColumn, id, deletedBy, extraPatch } = {}) {
  const key = String(id || '').trim();
  if (!sb || !table || !idColumn || !key) return false;
  const { data, error } = await sb.from(table).select('*').eq(idColumn, key).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  if (data.deleted_at) return true;
  const { error: insErr } = await sb.from('deleted_records').insert({
    source_table: table,
    source_id: key,
    payload: data,
    deleted_by: deletedBy || null,
  });
  if (insErr) throw insErr;
  const { error: upErr } = await sb
    .from(table)
    .update({ deleted_at: new Date().toISOString(), ...(extraPatch || {}) })
    .eq(idColumn, key);
  if (upErr) throw upErr;
  return true;
}

function excludeDeleted(query) {
  return query.is('deleted_at', null);
}

module.exports = { archiveAndSoftDelete, excludeDeleted };
