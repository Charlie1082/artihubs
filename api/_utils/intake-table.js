const allowedIntakeTables = new Set(["public_intake", "intake_submissions"]);

function intakeTableName() {
  const table = String(process.env.INTAKE_TABLE || "public_intake").trim();
  if (!allowedIntakeTables.has(table)) {
    const error = new Error("invalid_intake_table");
    error.code = "INVALID_INTAKE_TABLE";
    throw error;
  }
  return table;
}

module.exports = {
  intakeTableName
};
