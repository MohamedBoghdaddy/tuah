import asyncHandler from "express-async-handler";
import { check, validationResult } from "express-validator";
import {
  listAllProductsRaw,
  findProductById,
  createProduct as createProductRow,
  updateProduct as updateProductRow,
  deleteProductById,
  isInWishlist,
  addToWishlist as addToWishlistRow,
} from "../models-pg/products.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);

// Validation middleware for product operations
export const validateProduct = [
  check("name", "Name is required").not().isEmpty(),
  check("description", "Description is required").not().isEmpty(),
  check("category", "Category is required").not().isEmpty(),
  check("price", "Price must be a number").isFloat({ min: 0 }),
  check("images", "Images must be an array").isArray(),
];

// Create Product (Admins & Employees Only) — legacy duplicate of adminProductController.js
export const createProduct = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, description, category, price, images } = req.body;
  const newProduct = await createProductRow({
    name, description, category, price,
    images: Array.isArray(images) ? images : [],
    stock: 0,
    created_by: req.user?.id || null,
  });

  res.status(201).json({ message: "Product created successfully", product: newProduct });
});

// Get all products (Public Access) — note: unlike the admin/public-catalog
// endpoints, this legacy route returns every product regardless of status.
export const getProducts = asyncHandler(async (req, res) => {
  const products = await listAllProductsRaw();
  res.status(200).json({ count: products.length, data: products });
});

// Get single product by ID (Public Access)
export const getProductById = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(404).json({ message: "Product not found" });
  }
  const product = await findProductById(req.params.id);
  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }
  res.status(200).json(product);
});

// Update product (Admins & Employees Only)
export const updateProduct = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  if (!isValidId(req.params.id)) {
    return res.status(404).json({ message: "Product not found" });
  }

  const { name, description, category, price, images } = req.body;
  const updatedProduct = await updateProductRow(req.params.id, {
    name, description, category, price, images,
  });

  if (!updatedProduct) {
    return res.status(404).json({ message: "Product not found" });
  }
  res.status(200).json({ message: "Product updated successfully", product: updatedProduct });
});

// Delete product (Admins & Employees Only)
export const deleteProduct = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(404).json({ message: "Product not found" });
  }
  const deletedProduct = await deleteProductById(req.params.id);
  if (!deletedProduct) {
    return res.status(404).json({ message: "Product not found" });
  }
  res.status(200).json({ message: "Product deleted successfully" });
});

// Add product to cart (Users Only)
export const addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity } = req.body;
  if (!productId || quantity <= 0) {
    return res.status(400).json({ message: "Invalid product or quantity" });
  }

  const product = await findProductById(productId);
  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }

  let cart = req.session.cart || [];
  const existingItem = cart.find((item) => String(item.productId) === String(productId));
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    cart.push({
      productId,
      name: product.name,
      price: product.price,
      quantity,
    });
  }

  req.session.cart = cart;
  res.status(200).json({ message: "Added to cart", cart });
});

// Checkout and Purchase (Users Only)
export const checkout = asyncHandler(async (req, res) => {
  if (!req.session.cart || req.session.cart.length === 0) {
    return res.status(400).json({ message: "Cart is empty" });
  }

  // Process payment logic (to be implemented later)
  req.session.cart = [];
  res.status(200).json({ message: "Purchase successful" });
});

// Add to Wishlist Function
export const addToWishlist = async (req, res) => {
  try {
    const { productId } = req.body;
    const userId = req.user?.id; // Ensure user is authenticated

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized. Please log in." });
    }
    if (!isValidId(productId)) {
      return res.status(404).json({ message: "Product not found" });
    }

    const product = await findProductById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (await isInWishlist(userId, productId)) {
      return res.status(400).json({ message: "Product already in wishlist" });
    }

    await addToWishlistRow(userId, productId);

    return res.status(200).json({
      message: "Product added to wishlist successfully",
    });
  } catch (error) {
    console.error("Error adding to wishlist:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
