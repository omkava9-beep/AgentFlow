/**
 * The table view the accessibility pass requires: any chart whose marks fall
 * below 3:1 against the surface has to offer the numbers directly, and a table
 * is also the honest fallback for screen readers and print.
 */
export default function DataTable({ columns, rows }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-default">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-bg-subtle text-subtle">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.numeric ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-default">
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-1.5 text-muted ${c.numeric ? 'text-right tabular-nums' : ''}`}
                >
                  {c.format ? c.format(row[c.key]) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
