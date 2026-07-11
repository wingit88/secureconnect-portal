import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStudentUpdateInput } from '../src/lib/student-update';

test('normalizes student detail updates and trims values', () => {
  const result = normalizeStudentUpdateInput({
    studentId: ' 2024-001 ',
    nama: '  Jane Doe  ',
    kelas: ' XI A ',
  });

  assert.deepEqual(result, {
    studentId: '2024-001',
    nama: 'Jane Doe',
    kelas: 'XI A',
  });
});

test('rejects empty updates', () => {
  assert.throws(() => normalizeStudentUpdateInput({ studentId: '   ' }), /at least one field/i);
});
