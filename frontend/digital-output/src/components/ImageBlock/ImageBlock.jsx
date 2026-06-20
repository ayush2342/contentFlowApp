import styles from './ImageBlock.module.scss';

const ImageBlock = ({ src, alt, caption }) => (
  <figure className={styles.imageBlock}>
    <img src={src} alt={alt} className={styles.image} />
    {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
  </figure>
);

export default ImageBlock;
