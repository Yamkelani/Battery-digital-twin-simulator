"""
Simplified Single Particle Model (SPM) for Li-ion Battery
============================================================

A physics-based electrochemical model solving lithium diffusion
in spherical active material particles.

Governing equation (Fick's second law in spherical coordinates):
    ∂c/∂t = D_s / r² * ∂/∂r(r² * ∂c/∂r)

Boundary conditions:
    ∂c/∂r|_{r=0} = 0                              (symmetry at center)
    -D_s * ∂c/∂r|_{r=R_p} = j_n                  (flux at surface)

Where:
    c       = lithium concentration in solid particle [mol/m³]
    D_s     = solid-state diffusion coefficient [m²/s]
    R_p     = particle radius [m]
    j_n     = molar flux at surface [mol/(m²·s)]

Butler-Volmer kinetics at the electrode surface:
    j_n = (i_0 / F) * [exp(α_a * F * η / (R*T)) - exp(-α_c * F * η / (R*T))]

Where:
    η       = overpotential = φ_s - φ_e - U_eq(c_s_surf)
    i_0     = exchange current density
    α_a, α_c = transfer coefficients (typically 0.5 each)

This model provides insight into:
    - Lithium concentration gradients within particles
    - Diffusion limitations at high C-rates
    - Surface vs bulk concentration (relevant for rate capability)
"""

import numpy as np
from dataclasses import dataclass
from typing import Optional

# Physical constants
FARADAY = 96485.33212  # Faraday constant [C/mol]
R_GAS = 8.314          # Universal gas constant [J/(mol·K)]


@dataclass
class SPMParameters:
    """Parameters for the Single Particle Model."""

    # === Negative Electrode (Graphite) ===
    R_p_neg: float = 5.86e-6       # Particle radius [m]
    D_s_neg_ref: float = 3.9e-14   # Solid diffusion coefficient at T_ref [m²/s]
    Ea_D_neg: float = 35000.0      # Activation energy for diffusion [J/mol]
    c_s_max_neg: float = 30555.0   # Maximum lithium concentration [mol/m³]
    epsilon_s_neg: float = 0.49    # Active material volume fraction [-]
    L_neg: float = 85.2e-6         # Electrode thickness [m]
    alpha_neg: float = 0.5         # Transfer coefficient [-]
    k_neg_ref: float = 6.48e-7     # Reaction rate constant [m^2.5/(mol^0.5·s)]
    stoich_0_neg: float = 0.03     # Stoichiometry at 0% SOC
    stoich_100_neg: float = 0.90   # Stoichiometry at 100% SOC

    # === Positive Electrode (NMC) ===
    R_p_pos: float = 5.22e-6       # Particle radius [m]
    D_s_pos_ref: float = 1.0e-14   # Solid diffusion coefficient at T_ref [m²/s]
    Ea_D_pos: float = 29000.0      # Activation energy for diffusion [J/mol]
    c_s_max_pos: float = 51555.0   # Maximum lithium concentration [mol/m³]
    epsilon_s_pos: float = 0.335   # Active material volume fraction [-]
    L_pos: float = 75.6e-6         # Electrode thickness [m]
    alpha_pos: float = 0.5         # Transfer coefficient [-]
    k_pos_ref: float = 3.42e-6     # Reaction rate constant [m^2.5/(mol^0.5·s)]
    stoich_0_pos: float = 0.93     # Stoichiometry at 0% SOC
    stoich_100_pos: float = 0.36   # Stoichiometry at 100% SOC

    # === Cell Properties ===
    A_cell: float = 0.1027         # Electrode area [m²]
    T_ref: float = 298.15          # Reference temperature [K]

    # Number of radial discretization points
    N_r: int = 30                  # Radial mesh points per particle


class SingleParticleModel:
    """
    Simplified Single Particle Model for electrochemical visualization.

    Solves radial diffusion in cathode and anode particles using
    finite difference method. Provides concentration profiles for
    3D visualization of ion transport.
    """

    def __init__(self, params: Optional[SPMParameters] = None):
        self.params = params or SPMParameters()
        N = self.params.N_r

        # Radial mesh for each electrode
        self.r_neg = np.linspace(0, self.params.R_p_neg, N)
        self.r_pos = np.linspace(0, self.params.R_p_pos, N)

        # Initialize concentration profiles (uniform)
        self._c_neg = np.ones(N) * 0.5 * self.params.c_s_max_neg  # 50% SOC
        self._c_pos = np.ones(N) * 0.7 * self.params.c_s_max_pos  # 50% SOC

        self.dr_neg = self.params.R_p_neg / (N - 1)
        self.dr_pos = self.params.R_p_pos / (N - 1)

    def _diffusion_coeff(self, D_ref: float, Ea: float, T: float) -> float:
        """Temperature-dependent diffusion coefficient."""
        return D_ref * np.exp(Ea / R_GAS * (1.0 / self.params.T_ref - 1.0 / T))

    def _specific_surface_area(self, R_p: float, epsilon_s: float) -> float:
        """Specific interfacial surface area [m²/m³]."""
        return 3.0 * epsilon_s / R_p

    def _molar_flux(self, current: float, electrode: str) -> float:
        """
        Calculate molar flux at particle surface.

        Args:
            current: Applied current [A] (positive = discharge)
            electrode: 'neg' or 'pos'
        """
        p = self.params
        if electrode == 'neg':
            a_s = self._specific_surface_area(p.R_p_neg, p.epsilon_s_neg)
            L = p.L_neg
            sign = 1.0  # During discharge, Li leaves anode
        else:
            a_s = self._specific_surface_area(p.R_p_pos, p.epsilon_s_pos)
            L = p.L_pos
            sign = -1.0  # During discharge, Li enters cathode

        # Current density per unit electrode area
        j = current / p.A_cell

        # Molar flux at particle surface
        j_n = sign * j / (a_s * L * FARADAY)
        return j_n

    def _solve_diffusion(self, c: np.ndarray, D_s: float, R_p: float,
                         dr: float, j_n: float, dt: float) -> np.ndarray:
        """
        Solve radial diffusion equation using explicit finite difference.

        Fick's law in spherical coordinates:
            ∂c/∂t = D_s / r² * ∂/∂r(r² * ∂c/∂r)
        """
        N = len(c)
        c_new = c.copy()

        # Interior points
        for i in range(1, N - 1):
            r = i * dr
            c_new[i] = c[i] + D_s * dt * (
                (c[i + 1] - 2 * c[i] + c[i - 1]) / dr**2 +
                (2.0 / r) * (c[i + 1] - c[i - 1]) / (2 * dr)
            )

        # Boundary condition at center: symmetry (dc/dr = 0)
        # Use L'Hôpital: limit as r->0 of (2/r)(dc/dr) = 2 * d²c/dr²
        c_new[0] = c[0] + D_s * dt * 3.0 * (c[1] - c[0]) * 2.0 / dr**2

        # Boundary condition at surface: flux
        # -D_s * dc/dr|_{R_p} = j_n
        c_new[N - 1] = c[N - 1] + D_s * dt * (
            (2.0 * (c[N - 2] - c[N - 1]) / dr**2) +
            (2.0 / R_p) * (-j_n / D_s + (c[N - 2] - c[N - 1]) / dr) / 1.0
        )
        # Apply flux BC directly
        c_new[N - 1] = c[N - 2] + dr * j_n / D_s

        return c_new

    def step(self, current: float, T: float, dt: float) -> dict:
        """
        Advance SPM by one time step.

        Args:
            current: Applied current [A]
            T: Temperature [K]
            dt: Time step [s] (keep small for explicit scheme stability!)

        Returns:
            dict with concentration profiles and electrochemical data
        """
        p = self.params

        # Temperature-dependent diffusion coefficients
        D_neg = self._diffusion_coeff(p.D_s_neg_ref, p.Ea_D_neg, T)
        D_pos = self._diffusion_coeff(p.D_s_pos_ref, p.Ea_D_pos, T)

        # Molar fluxes
        j_n_neg = self._molar_flux(current, 'neg')
        j_n_pos = self._molar_flux(current, 'pos')

        # Sub-stepping for numerical stability (CFL condition)
        max_dt = min(
            0.4 * self.dr_neg**2 / D_neg,
            0.4 * self.dr_pos**2 / D_pos,
        )
        n_substeps = max(1, int(np.ceil(dt / max_dt)))
        sub_dt = dt / n_substeps

        for _ in range(n_substeps):
            self._c_neg = self._solve_diffusion(
                self._c_neg, D_neg, p.R_p_neg, self.dr_neg, j_n_neg, sub_dt
            )
            self._c_pos = self._solve_diffusion(
                self._c_pos, D_pos, p.R_p_pos, self.dr_pos, j_n_pos, sub_dt
            )

        # Clamp concentrations to physical limits
        self._c_neg = np.clip(self._c_neg, 0, p.c_s_max_neg)
        self._c_pos = np.clip(self._c_pos, 0, p.c_s_max_pos)

        # Normalized concentrations (stoichiometry)
        theta_neg_surf = self._c_neg[-1] / p.c_s_max_neg
        theta_pos_surf = self._c_pos[-1] / p.c_s_max_pos
        theta_neg_avg = np.mean(self._c_neg) / p.c_s_max_neg
        theta_pos_avg = np.mean(self._c_pos) / p.c_s_max_pos

        # Concentration gradient (surface - center)
        neg_gradient = (self._c_neg[-1] - self._c_neg[0]) / p.c_s_max_neg
        pos_gradient = (self._c_pos[-1] - self._c_pos[0]) / p.c_s_max_pos

        return {
            # Normalized concentration profiles for visualization
            "neg_concentration": (self._c_neg / p.c_s_max_neg).tolist(),
            "pos_concentration": (self._c_pos / p.c_s_max_pos).tolist(),

            # Surface stoichiometries
            "neg_surface_stoich": float(theta_neg_surf),
            "pos_surface_stoich": float(theta_pos_surf),

            # Average stoichiometries
            "neg_avg_stoich": float(theta_neg_avg),
            "pos_avg_stoich": float(theta_pos_avg),

            # Concentration gradients (indicator of diffusion limitation)
            "neg_gradient": float(neg_gradient),
            "pos_gradient": float(pos_gradient),

            # Radial positions (normalized 0-1)
            "r_normalized": np.linspace(0, 1, p.N_r).tolist(),

            # Diffusion limitation indicator (0=no limitation, 1=severe)
            "diffusion_limitation": float(min(abs(neg_gradient) + abs(pos_gradient), 1.0)),
        }

    def set_soc(self, soc: float):
        """Set initial concentration profiles for a given SOC."""
        p = self.params
        theta_neg = p.stoich_0_neg + soc * (p.stoich_100_neg - p.stoich_0_neg)
        theta_pos = p.stoich_0_pos + soc * (p.stoich_100_pos - p.stoich_0_pos)

        self._c_neg[:] = theta_neg * p.c_s_max_neg
        self._c_pos[:] = theta_pos * p.c_s_max_pos

    def reset(self, soc: float = 0.5):
        """Reset to uniform concentration at given SOC."""
        self.set_soc(soc)
