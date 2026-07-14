import styles from './ImageBlock.module.scss';

const captionParts = (caption) => {
  const text = String(caption ?? '').trim();
  // PDF captions use FIGURE or EXHIBIT prefixes
  const match = text.match(/^((?:FIGURE|EXHIBIT)\s+\d+(?:\.\d+)?)([\s\S]*)$/i);
  if (!match) return null;
  return {
    prefix: match[1],
    rest: match[2] || '',
  };
};

const ImageBlock = ({ src, alt, caption }) => {
  const parsedCaption = captionParts(caption);

  return (
    <figure className={styles.imageBlock}>
      <img src={src} alt={alt} className={styles.image} />
      {caption ? (
        <figcaption className={styles.caption}>
          {parsedCaption ? (
            <>
              <span className={styles.figurePrefix}>{parsedCaption.prefix}</span>
              {parsedCaption.rest}
            </>
          ) : (
            caption
          )}
        </figcaption>
      ) : null}
    </figure>
  );
};

export default ImageBlock;
