import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

// The top of every page inside a workspace: what it is, a line about it, and the page's main action on the right.
export default function PageHeader({
  title,
  description,
  badge,
  actions,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <div className={styles.title}>
          <h1>{title}</h1>
          {badge}
        </div>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
