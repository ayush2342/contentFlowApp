import styles from './TableBlock.module.scss';

const cellText = (cell) => {
  if (cell == null) return '';
  if (typeof cell === 'object') return cell.text == null ? '' : String(cell.text);
  return String(cell);
};

const CellText = ({ value }) => {
  const lines = cellText(value).split('\n');
  return lines.map((line, index) => (
    <span key={index}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
};

const isObjectRow = (row) =>
  Array.isArray(row) && row.length > 0 && row[0] !== null && typeof row[0] === 'object';

/**
 * Cell-object tables (header_row_count + rows of { text }) and the older
 * cols + string-rows shape. Fonts, alignment, and borders come from the theme.
 */
const TableBlock = ({ title, rows, cols, columnWidths, headerRowCount = 1 }) => {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const columnHeaders = Array.isArray(cols) ? cols : [];
  const objectRows = sourceRows.length > 0 && isObjectRow(sourceRows[0]);

  let headerRows = [];
  let bodyRows = [];

  if (objectRows) {
    const count = headerRowCount > 0 ? headerRowCount : 1;
    headerRows = sourceRows.slice(0, count);
    bodyRows = sourceRows.slice(count);
  } else if (columnHeaders.length) {
    headerRows = [columnHeaders];
    bodyRows = sourceRows;
  } else {
    bodyRows = sourceRows;
  }

  const columnCount = Math.max(
    headerRows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0),
    bodyRows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0),
    columnHeaders.length
  );

  if (!columnCount) return null;

  const widths = Array.isArray(columnWidths) ? columnWidths : [];
  const widthSum = widths.reduce((sum, width) => sum + (Number(width) || 0), 0);
  const useWidths = widths.length === columnCount && widthSum > 0;

  return (
    <div className={styles.tableBlock}>
      {title ? <h4 className={styles.title}>{title}</h4> : null}
      <div className={styles.wrapper}>
        <table className={styles.table}>
          {useWidths ? (
            <colgroup>
              {widths.map((width, index) => (
                <col key={`col-${index}`} style={{ width: `${(Number(width) / widthSum) * 100}%` }} />
              ))}
            </colgroup>
          ) : null}
          {headerRows.length ? (
            <thead>
              {headerRows.map((row, rowIndex) => (
                <tr key={`header-${rowIndex}`}>
                  {Array.from({ length: columnCount }, (_, cellIndex) => (
                    <th key={`header-${rowIndex}-${cellIndex}`}>
                      <CellText value={Array.isArray(row) ? row[cellIndex] : ''} />
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
          ) : null}
          <tbody>
            {bodyRows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {Array.from({ length: columnCount }, (_, cellIndex) => (
                  <td key={`cell-${rowIndex}-${cellIndex}`}>
                    <CellText value={Array.isArray(row) ? row[cellIndex] : row} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TableBlock;
