import styles from './TableBlock.module.scss';

const TableBlock = ({ title, headers = [], rows = [] }) => (
  <div className={styles.tableBlock}>
    {title && <h4 className={styles.title}>{title}</h4>}
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default TableBlock;
