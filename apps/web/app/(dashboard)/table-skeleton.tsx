export function TableSkeleton({
  columns,
  rows = 5,
}: {
  columns: { label: string; numeric?: boolean; width: string; stacked?: boolean }[];
  rows?: number;
}) {
  return (
    <div className="hk-table-wrap" aria-hidden="true">
      <table className="hk-table" data-skeleton>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={column.numeric ? "hk-numeric" : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {columns.map((column) => (
                <td key={column.label} className={column.numeric ? "hk-numeric" : undefined}>
                  <span className="hk-skeleton-bar" style={{ width: column.width }} />
                  {column.stacked && (
                    <span className="hk-skeleton-bar" data-thin style={{ width: "40%" }} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
