import styles from './TableBlock.module.scss';

/**
 * Supports:
 * {
 *   cols: ["col1", "col2"],
 *   index?: { name, values } | [{ name, values }, ...],
 *   rows: [["a","b"], ...]
 * }
 */
const normalizeIndexes = (index) => {
  if (!index) return [];
  if (Array.isArray(index)) return index.filter((item) => item && Array.isArray(item.values));
  if (typeof index === 'object' && Array.isArray(index.values)) return [index];
  return [];
};

const TableBlock = ({ title, table, cols, index, rows, headers }) => {
  const tableData = table && typeof table === 'object' ? table : { cols, index, rows };
  const columnHeaders = Array.isArray(tableData.cols)
    ? tableData.cols
    : Array.isArray(headers)
      ? headers
      : [];
  const dataRows = Array.isArray(tableData.rows) ? tableData.rows : [];
  const indexes = normalizeIndexes(tableData.index);

  if (!columnHeaders.length && !dataRows.length) return null;

  // Validate: each index.values length should match rows length when present.
  const validIndexes = indexes.filter(
    (idx) => !dataRows.length || idx.values.length === dataRows.length
  );

  return (
    <div className={styles.tableBlock}>
      {title ? <h4 className={styles.title}>{title}</h4> : null}
      <div className={styles.wrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              {validIndexes.map((idx) => (
                <th key={`idx-h-${idx.name || 'index'}`} className={styles.subHeading}>
                  {idx.name || ''}
                </th>
              ))}
              {columnHeaders.map((header, headerIndex) => (
                <th key={`col-${headerIndex}`}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, rowIndex) => {
              const cells = Array.isArray(row) ? row : [row];
              return (
                <tr key={`row-${rowIndex}`}>
                  {validIndexes.map((idx) => (
                    <td key={`idx-${idx.name || 'index'}-${rowIndex}`} className={styles.indexCell}>
                      {idx.values[rowIndex] ?? ''}
                    </td>
                  ))}
                  {columnHeaders.map((_, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`}>{cells[cellIndex] ?? ''}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TableBlock;
