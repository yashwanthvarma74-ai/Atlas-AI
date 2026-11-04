import styles from './Logo.module.css';

// The mark: an A drawn as a path, on a square. Decorative wherever it appears next to the name.
export default function Logo() {
  return (
    <svg viewBox="0 0 24 24" className={styles.logo} aria-hidden="true">
      <rect width="24" height="24" rx="6" />
      <path d="M7.5 17 12 6.5 16.5 17M9.4 13h5.2" />
    </svg>
  );
}
