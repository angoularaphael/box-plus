-- Liste commandes sans télécharger photos / signatures (egress).
-- À coller dans SQL Editor une fois le projet de nouveau joignable.
-- Ne supprime aucune donnée.

alter table public.boxplus_orders
  add column if not exists summary jsonb;

create index if not exists boxplus_orders_summary_pay_idx
  on public.boxplus_orders ((summary->'payment'->>'status'));

-- Backfill : résumé sans images. Le payload complet reste en place pour
-- le chargement d'une commande (photo bot, IBAN, signature).
update public.boxplus_orders
set summary = jsonb_strip_nulls(
  jsonb_build_object(
    'order_id', payload->>'order_id',
    'access_token', payload->>'access_token',
    'action', payload->>'action',
    'step', payload->'step',
    'product_id', coalesce(payload->>'product_id', payload->'product_snapshot'->>'id'),
    'product_name', payload->>'product_name',
    'product_snapshot', jsonb_build_object(
      'id', payload->'product_snapshot'->>'id',
      'legacy_id', payload->'product_snapshot'->>'legacy_id',
      'name', payload->'product_snapshot'->>'name',
      'display_name', payload->'product_snapshot'->>'display_name',
      'price_cents', payload->'product_snapshot'->'price_cents',
      'requires_payment', payload->'product_snapshot'->'requires_payment'
    ),
    'payment', jsonb_build_object(
      'status', payload->'payment'->>'status',
      'paid_at', payload->'payment'->>'paid_at',
      'stripe_subscription_id', payload->'payment'->>'stripe_subscription_id',
      'subscription_id', payload->'payment'->>'subscription_id',
      'payplug_payment_id', payload->'payment'->>'payplug_payment_id'
    ),
    'customer_short', jsonb_build_object(
      'first_name', payload->'customer_short'->>'first_name',
      'last_name', payload->'customer_short'->>'last_name',
      'email', payload->'customer_short'->>'email',
      'phone', payload->'customer_short'->>'phone'
    ),
    'customer_full', jsonb_build_object(
      'gym', payload->'customer_full'->>'gym',
      'email', payload->'customer_full'->>'email'
    ),
    'funnel', payload->'funnel',
    'signature', jsonb_build_object('signed_at', payload->'signature'->>'signed_at'),
    'created_at', payload->>'created_at',
    'updated_at', payload->>'updated_at'
  )
)
where summary is null;
