import { Link } from "react-router-dom";
import "./homepage-premium.css";

const HeroSection = () => (
  <section className="tuah-hero" aria-labelledby="tuah-hero-title">
    <div className="tuah-home-container tuah-hero-grid">
      <div className="tuah-hero-copy">
        <span>EST. 2024</span>
        <h1 id="tuah-hero-title">Design-led furniture for modern living.</h1>
        <p>
          Experience the pinnacle of premium crafted furniture and customizable interiors.
          Each piece is an intentional statement of luxury, designed to harmonize with your
          unique spatial narrative.
        </p>
        <div className="tuah-hero-actions">
          <Link to="/collections" className="tuah-home-primary-btn">
            Shop Collections
          </Link>
          <Link to="/contact" className="tuah-home-outline-btn">
            Book a Showroom Visit
          </Link>
        </div>
      </div>

      <div className="tuah-hero-image-wrap">
        <span className="tuah-hero-image-back" aria-hidden="true" />
        <img
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuAK9BS_GWXIhpSoNzvZlecqJawyFOztxSWGC41eA78BybgayPVNQc_PdpD1SqIrl21z_waJ0orN3wWs4fpwY0icIwE-dIDZ4be24NtrGCHhSVetdOdlY7j9VVVrB_kRARENtGzv8Mh8k7MZC8xHh6RVDjAtE_tuO1P0tTqWXvFLF-WQWAxQpS3dt_-ZMij30zZNT6jVfR_RuBhTd0C6YdVji9QIM-YkPYeKskO8PAzRchOWlJu-BOk1f8yu9c94qZR8rBW1kPBoOFo5"
          alt="Luxury living room with premium crafted furniture"
        />
      </div>
    </div>
  </section>
);

export default HeroSection;
