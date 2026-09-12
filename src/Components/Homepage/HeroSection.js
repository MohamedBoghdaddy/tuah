import { Link } from "react-router-dom";
import "./homepage-premium.css";

const HeroSection = () => (
  <section className="tuwa-hero" aria-labelledby="tuwa-hero-title">
    <div className="tuwa-home-container tuwa-hero-grid">
      <div className="tuwa-hero-copy">
        <span>EST. 2024</span>
        <h1 id="tuwa-hero-title">Design-led furniture for modern living.</h1>
        <p>
          Experience the pinnacle of premium crafted furniture and customizable interiors.
          Each piece is an intentional statement of luxury, designed to harmonize with your
          unique spatial narrative.
        </p>
        <div className="tuwa-hero-actions">
          <Link to="/collections" className="tuwa-home-primary-btn">
            Shop Collections
          </Link>
          <Link to="/contact" className="tuwa-home-outline-btn">
            Book a Showroom Visit
          </Link>
        </div>
      </div>

      <div className="tuwa-hero-image-wrap">
        <span className="tuwa-hero-image-back" aria-hidden="true" />
        <img
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuAK9BS_GWXIhpSoNzvZlecqJawyFOztxSWGC41eA78BybgayPVNQc_PdpD1SqIrl21z_waJ0orN3wWs4fpwY0icIwE-dIDZ4be24NtrGCHhSVetdOdlY7j9VVVrB_kRARENtGzv8Mh8k7MZC8xHh6RVDjAtE_tuO1P0tTqWXvFLF-WQWAxQpS3dt_-ZMij30zZNT6jVfR_RuBhTd0C6YdVji9QIM-YkPYeKskO8PAzRchOWlJu-BOk1f8yu9c94qZR8rBW1kPBoOFo5"
          alt="Luxury living room with premium crafted furniture"
        />
      </div>
    </div>
  </section>
);

export default HeroSection;
