/**
 * The table view the accessibility pass requires: any chart whose marks fall
 * below 3:1 against the surface has to offer the numbers directly, and a table
 * is also the honest fallback for screen readers and print.
 */
export default function DataTable({ columns, rows }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.numeric ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-1.5 text-slate-600 dark:text-slate-300 ${c.numeric ? 'text-right tabular-nums' : ''}`}
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
