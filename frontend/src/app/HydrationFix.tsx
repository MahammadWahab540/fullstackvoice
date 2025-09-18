"use client";

import React from "react";

export function HydrationFix(): React.JSX.Element {
  return (
    <script
      id="hydration-fix"
      dangerouslySetInnerHTML={{
        __html: `
          if (document.body.hasAttribute('data-atm-ext-installed')) {
            document.body.removeAttribute('data-atm-ext-installed');
          }
          const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
              if (
                mutation.type === 'attributes' &&
                mutation.attributeName === 'data-atm-ext-installed'
              ) {
                document.body.removeAttribute('data-atm-ext-installed');
              }
            });
          });
          observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['data-atm-ext-installed']
          });
        `,
      }}
    />
  );
}
