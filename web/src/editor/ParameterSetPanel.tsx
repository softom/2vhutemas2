import type {ReactNode} from 'react';

/** One presentation for inherited and individually attached parameter sets. */
export function ParameterSetPanel({title,children}:{title:string;children:ReactNode}) {
  return <details className="research-set-card parameter-set-panel">
    <summary>{title}</summary>
    {children}
  </details>;
}
