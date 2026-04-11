import type { RelationshipInsight } from '../lib/analytics'
import { correlationLabel, relativeColor } from '../lib/analytics'

interface RelationshipPanelProps {
  relationships: RelationshipInsight[]
}

export function RelationshipPanel({ relationships }: RelationshipPanelProps) {
  const strongest = relationships.slice(0, 4)

  return (
    <div className="relationship-panel">
      <div className="relationship-panel__summary">
        <p className="relationship-panel__eyebrow">Interpretability</p>
        <h3>Where the selected signals travel together</h3>
        <p>
          The panel focuses on magnitude first. High correlations are highlighted as directional hints,
          not causal claims.
        </p>
      </div>

      <div className="relationship-panel__list">
        {strongest.map((relationship) => {
          const tone = relativeColor(relationship.correlation)

          return (
            <article className={`relationship-card relationship-card--${tone}`} key={relationship.label}>
              <div className="relationship-card__top">
                <p>{relationship.label}</p>
                <span>{correlationLabel(relationship.correlation)}</span>
              </div>
              <strong>{relationship.correlation.toFixed(2)}</strong>
              <p>{relationship.interpretation}</p>
            </article>
          )
        })}
      </div>
    </div>
  )
}

