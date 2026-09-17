/* Every order-list route joins this same per-order item summary — without
   it, a card can only show the order's total, not what was actually
   bought (customer/orders.html's thumbnail + item name, vendor/orders.html's
   line-item list, admin/customer-detail.html's & vendor-detail.html's Orders
   sections). JSON_ARRAYAGG keeps this to one query instead of an extra
   round trip per order. Assumes the query aliases the orders table as `o`. */
const ORDER_ITEMS_SUBQUERY = `
  (SELECT JSON_ARRAYAGG(JSON_OBJECT(
     'id', oi.id, 'productId', oi.product_id, 'name', p.name, 'quantity', oi.quantity,
     'priceAtPurchase', oi.price_at_purchase, 'image', JSON_EXTRACT(p.images, '$[0]'),
     'status', oi.status, 'unavailableReason', oi.unavailable_reason
   )) FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id)
`;

module.exports = { ORDER_ITEMS_SUBQUERY };
