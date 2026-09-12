import mongoose from "mongoose";

const CartItemSchema = new mongoose.Schema(
  {
    // Postgres UUID (products now live in Supabase Postgres, not this DB) —
    // plain String rather than ObjectId so Mongoose doesn't try to cast it.
    productId: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const CartSchema = new mongoose.Schema(
  {
    // Postgres UUID (users now live in Supabase Postgres, not this DB) —
    // plain String rather than ObjectId so Mongoose doesn't try to cast it.
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    items: {
      type: [CartItemSchema],
      default: [],
    },
  },
  { timestamps: true },
);

CartSchema.index({ "items.productId": 1 });

const Cart = mongoose.models.Cart || mongoose.model("Cart", CartSchema);

export default Cart;
