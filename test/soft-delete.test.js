const { test } = require('node:test');
const assert = require('node:assert/strict');
const { archiveAndSoftDelete, excludeDeleted } = require('../lib/soft-delete');

function fakeSb(row) {
  const calls = [];
  const api = {
    from(table) {
      const q = {
        table,
        _filters: {},
        select() {
          return q;
        },
        eq(col, val) {
          q._filters[col] = val;
          return q;
        },
        is() {
          return q;
        },
        async maybeSingle() {
          calls.push(['select', table]);
          return { data: row, error: null };
        },
        insert(payload) {
          calls.push(['insert', table, payload]);
          return Promise.resolve({ error: null });
        },
        update(payload) {
          calls.push(['update', table, payload]);
          return {
            eq() {
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return q;
    },
    calls,
  };
  return api;
}

test('archive puis deleted_at, jamais de delete()', async () => {
  const row = { order_id: 'BC-1', payload: { a: 1 } };
  const sb = fakeSb(row);
  const ok = await archiveAndSoftDelete(sb, {
    table: 'boxplus_orders',
    idColumn: 'order_id',
    id: 'BC-1',
    deletedBy: 'test',
  });
  assert.equal(ok, true);
  assert.equal(sb.calls.some((c) => c[0] === 'insert' && c[1] === 'deleted_records'), true);
  const up = sb.calls.find((c) => c[0] === 'update');
  assert.ok(up[2].deleted_at);
  assert.equal(sb.calls.some((c) => c[0] === 'delete'), false);
});

test('excludeDeleted pose le filtre deleted_at null', () => {
  const seen = {};
  const q = {
    is(col, val) {
      seen.col = col;
      seen.val = val;
      return q;
    },
  };
  excludeDeleted(q);
  assert.equal(seen.col, 'deleted_at');
  assert.equal(seen.val, null);
});
