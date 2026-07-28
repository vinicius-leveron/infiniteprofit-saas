import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type CheckoutProductBinding,
  type CheckoutProductRole,
  type WorkspaceCheckoutCatalogSafeRow,
} from "@/lib/operationalReadApi";
import { cn } from "@/lib/utils";

export function HotmartProductBindings({
  catalog,
  value,
  disabled,
  onChange,
}: {
  catalog: WorkspaceCheckoutCatalogSafeRow[];
  value: CheckoutProductBinding[];
  disabled: boolean;
  onChange: (value: CheckoutProductBinding[]) => void;
}) {
  const front = value.find((item) => item.role === "front") ?? null;
  const selectableCatalog = catalog.filter((product) => {
    const status = product.product_status.toUpperCase();
    return (
      !["DELETED", "INACTIVE", "DISABLED", "UNAVAILABLE"].includes(status)
      || value.some((item) => item.product_id === product.product_id)
    );
  });

  function selectFront(productId: string) {
    const previous = value.find((item) => item.product_id === productId);
    const next = value.filter(
      (item) => item.role !== "front" && item.product_id !== productId,
    );
    onChange([
      {
        product_id: productId,
        offer_id: previous?.offer_id ?? null,
        role: "front",
      },
      ...next,
    ]);
  }

  function toggleOptional(productId: string, checked: boolean) {
    if (!checked) {
      onChange(value.filter((item) => item.product_id !== productId));
      return;
    }
    onChange([
      ...value.filter((item) => item.product_id !== productId),
      { product_id: productId, offer_id: null, role: "order_bump" },
    ]);
  }

  function updateBinding(
    productId: string,
    patch: Partial<Pick<CheckoutProductBinding, "offer_id" | "role">>,
  ) {
    onChange(
      value.map((item) =>
        item.product_id === productId ? { ...item, ...patch } : item,
      ),
    );
  }

  const frontProduct = selectableCatalog.find(
    (product) => product.product_id === front?.product_id,
  );

  return (
    <div className="space-y-5 rounded-xl border border-border/60 p-4 md:p-5">
      <div>
        <h3 className="text-sm font-semibold">Produtos deste funil</h3>
        <p className="mt-1 text-xs leading-4 text-muted-foreground">
          O front é obrigatório. Bumps e upsells são opcionais e só entram neste
          funil quando estiverem vinculados aqui.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="hotmart-front-product" className="text-sm font-medium">
            Produto front
          </label>
          <Select
            value={front?.product_id ?? ""}
            disabled={disabled}
            onValueChange={selectFront}
          >
            <SelectTrigger id="hotmart-front-product" className="min-h-11">
              <SelectValue placeholder="Selecione o produto principal" />
            </SelectTrigger>
            <SelectContent>
              {selectableCatalog.map((product) => (
                <SelectItem key={product.product_id} value={product.product_id}>
                  {product.product_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {front && frontProduct ? (
          <OfferSelect
            id="hotmart-front-offer"
            product={frontProduct}
            value={front.offer_id}
            disabled={disabled}
            onChange={(offerId) =>
              updateBinding(front.product_id, { offer_id: offerId })
            }
          />
        ) : null}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Order bumps e upsells</p>
        {selectableCatalog
          .filter((product) => product.product_id !== front?.product_id)
          .map((product) => {
            const binding = value.find(
              (item) =>
                item.product_id === product.product_id
                && item.role !== "front",
            );
            return (
              <div
                key={product.product_id}
                className={cn(
                  "rounded-lg border p-3",
                  binding
                    ? "border-primary/35 bg-primary/5"
                    : "border-border/60",
                )}
              >
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <Checkbox
                    checked={Boolean(binding)}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      toggleOptional(product.product_id, checked === true)
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {product.product_name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {product.provider_product_id}
                    </span>
                  </span>
                </label>
                {binding ? (
                  <div className="mt-3 grid gap-3 border-t pt-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label
                        htmlFor={`hotmart-role-${product.product_id}`}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Papel
                      </label>
                      <Select
                        value={binding.role}
                        disabled={disabled}
                        onValueChange={(role) =>
                          updateBinding(product.product_id, {
                            role: role as CheckoutProductRole,
                          })
                        }
                      >
                        <SelectTrigger
                          id={`hotmart-role-${product.product_id}`}
                          className="min-h-11"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="order_bump">Order bump</SelectItem>
                          <SelectItem value="upsell">Upsell</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <OfferSelect
                      id={`hotmart-offer-${product.product_id}`}
                      product={product}
                      value={binding.offer_id}
                      disabled={disabled}
                      onChange={(offerId) =>
                        updateBinding(product.product_id, {
                          offer_id: offerId,
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function OfferSelect({
  id,
  product,
  value,
  disabled,
  onChange,
}: {
  id: string;
  product: WorkspaceCheckoutCatalogSafeRow;
  value: string | null;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Oferta
      </label>
      <Select
        value={value ?? "all-offers"}
        disabled={disabled}
        onValueChange={(offerId) =>
          onChange(offerId === "all-offers" ? null : offerId)
        }
      >
        <SelectTrigger id={id} className="min-h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all-offers">Todas as ofertas</SelectItem>
          {product.offers
            .filter(
              (offer) =>
                !["DELETED", "INACTIVE", "DISABLED", "UNAVAILABLE"].includes(
                  offer.status.toUpperCase(),
                ),
            )
            .map((offer) => (
              <SelectItem key={offer.id} value={offer.id}>
                {offer.name || offer.code}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}
