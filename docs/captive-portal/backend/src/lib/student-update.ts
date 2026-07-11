export type StudentUpdateInput = {
  studentId?: string;
  nama?: string;
  kelas?: string;
};

export function normalizeStudentUpdateInput(input: StudentUpdateInput) {
  const studentId = input.studentId?.trim();
  const nama = input.nama?.trim();
  const kelas = input.kelas?.trim();

  const payload = {
    ...(studentId ? { studentId } : {}),
    ...(nama ? { nama } : {}),
    ...(kelas ? { kelas } : {}),
  };

  if (Object.keys(payload).length === 0) {
    throw new Error("Provide at least one field to update.");
  }

  return payload;
}
