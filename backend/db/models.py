from sqlalchemy import (
    Column, Integer, Text, Numeric, Date, Boolean, ForeignKey,
    TIMESTAMP, CheckConstraint, text
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Property(Base):
    __tablename__ = "properties"
    __table_args__ = {"schema": "rental"}

    property_id   = Column(Integer, primary_key=True)
    address       = Column(Text, nullable=False)
    city          = Column(Text, nullable=False)
    state         = Column(Text, nullable=False)
    zip           = Column(Text)
    property_type = Column(Text)
    notes         = Column(Text)
    created_at    = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    units             = relationship("Unit", back_populates="property", cascade="all, delete-orphan")
    maintenance_tasks = relationship("MaintenanceTask", back_populates="property")


class Unit(Base):
    __tablename__ = "units"
    __table_args__ = {"schema": "rental"}

    unit_id     = Column(Integer, primary_key=True)
    property_id = Column(Integer, ForeignKey("rental.properties.property_id", ondelete="CASCADE"), nullable=False)
    unit_number = Column(Text, nullable=False, default="1")
    bedrooms    = Column(Integer)
    bathrooms   = Column(Numeric(3, 1))
    sq_ft       = Column(Integer)
    notes       = Column(Text)

    property             = relationship("Property", back_populates="units")
    leases               = relationship("Lease", back_populates="unit", cascade="all, delete-orphan")
    maintenance_tasks    = relationship("MaintenanceTask", back_populates="unit")
    maintenance_requests = relationship("MaintenanceRequest", back_populates="unit")


class Tenant(Base):
    __tablename__ = "tenants"
    __table_args__ = {"schema": "rental"}

    tenant_id  = Column(Integer, primary_key=True)
    first_name = Column(Text, nullable=False)
    last_name  = Column(Text, nullable=False)
    email      = Column(Text)
    phone      = Column(Text)
    notes      = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    lease_tenants        = relationship("LeaseTenant", back_populates="tenant")
    maintenance_requests = relationship("MaintenanceRequest", back_populates="tenant")


class Lease(Base):
    __tablename__ = "leases"
    __table_args__ = {"schema": "rental"}

    lease_id         = Column(Integer, primary_key=True)
    unit_id          = Column(Integer, ForeignKey("rental.units.unit_id", ondelete="CASCADE"), nullable=False)
    start_date       = Column(Date, nullable=False)
    end_date         = Column(Date)
    monthly_rent     = Column(Numeric(10, 2), nullable=False)
    security_deposit = Column(Numeric(10, 2))
    status           = Column(Text, nullable=False, default="active")
    notes            = Column(Text)
    created_at       = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    unit          = relationship("Unit", back_populates="leases")
    lease_tenants = relationship("LeaseTenant", back_populates="lease", cascade="all, delete-orphan")
    payments      = relationship("Payment", back_populates="lease", cascade="all, delete-orphan")


class LeaseTenant(Base):
    __tablename__ = "lease_tenants"
    __table_args__ = {"schema": "rental"}

    lease_id   = Column(Integer, ForeignKey("rental.leases.lease_id", ondelete="CASCADE"), primary_key=True)
    tenant_id  = Column(Integer, ForeignKey("rental.tenants.tenant_id", ondelete="CASCADE"), primary_key=True)
    is_primary = Column(Boolean, nullable=False, default=False)

    lease  = relationship("Lease", back_populates="lease_tenants")
    tenant = relationship("Tenant", back_populates="lease_tenants")


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = {"schema": "rental"}

    payment_id      = Column(Integer, primary_key=True)
    lease_id        = Column(Integer, ForeignKey("rental.leases.lease_id", ondelete="CASCADE"), nullable=False)
    due_date        = Column(Date, nullable=False)
    amount_due      = Column(Numeric(10, 2), nullable=False)
    amount_paid     = Column(Numeric(10, 2))
    paid_date       = Column(Date)
    payment_method  = Column(Text)   # interac, cash
    status          = Column(Text, nullable=False, default="pending")
    promised_date   = Column(Date)
    promised_amount = Column(Numeric(10, 2))
    notes           = Column(Text)

    lease = relationship("Lease", back_populates="payments")


class Vendor(Base):
    __tablename__ = "vendors"
    __table_args__ = {"schema": "rental"}

    vendor_id    = Column(Integer, primary_key=True)
    company_name = Column(Text, nullable=False)
    contact_name = Column(Text)
    phone        = Column(Text)
    email        = Column(Text)
    trade        = Column(Text)
    notes        = Column(Text)
    created_at   = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    maintenance_records  = relationship("MaintenanceRecord", back_populates="vendor")
    maintenance_requests = relationship("MaintenanceRequest", back_populates="vendor")
    invoices             = relationship("Invoice", back_populates="vendor")


class MaintenanceTask(Base):
    __tablename__ = "maintenance_tasks"
    __table_args__ = (
        CheckConstraint("property_id IS NOT NULL OR unit_id IS NOT NULL", name="chk_task_scope"),
        {"schema": "rental"},
    )

    task_id             = Column(Integer, primary_key=True)
    property_id         = Column(Integer, ForeignKey("rental.properties.property_id", ondelete="CASCADE"))
    unit_id             = Column(Integer, ForeignKey("rental.units.unit_id", ondelete="CASCADE"))
    task_name           = Column(Text, nullable=False)
    category            = Column(Text)
    description         = Column(Text)
    frequency_days      = Column(Integer)
    last_completed_date = Column(Date)
    next_due_date       = Column(Date)
    status              = Column(Text, nullable=False, default="active")

    property = relationship("Property", back_populates="maintenance_tasks")
    unit     = relationship("Unit", back_populates="maintenance_tasks")
    records  = relationship("MaintenanceRecord", back_populates="task", cascade="all, delete-orphan")


class MaintenanceRecord(Base):
    __tablename__ = "maintenance_records"
    __table_args__ = {"schema": "rental"}

    record_id      = Column(Integer, primary_key=True)
    task_id        = Column(Integer, ForeignKey("rental.maintenance_tasks.task_id", ondelete="CASCADE"), nullable=False)
    vendor_id      = Column(Integer, ForeignKey("rental.vendors.vendor_id"))
    completed_date = Column(Date, nullable=False)
    completed_by   = Column(Text)
    notes          = Column(Text)
    created_at     = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    task     = relationship("MaintenanceTask", back_populates="records")
    vendor   = relationship("Vendor", back_populates="maintenance_records")
    invoices = relationship("Invoice", back_populates="record")


class MaintenanceRequest(Base):
    __tablename__ = "maintenance_requests"
    __table_args__ = {"schema": "rental"}

    request_id                = Column(Integer, primary_key=True)
    unit_id                   = Column(Integer, ForeignKey("rental.units.unit_id", ondelete="CASCADE"), nullable=False)
    tenant_id                 = Column(Integer, ForeignKey("rental.tenants.tenant_id"))
    vendor_id                 = Column(Integer, ForeignKey("rental.vendors.vendor_id"))
    reported_date             = Column(Date, nullable=False, server_default=text("CURRENT_DATE"))
    description               = Column(Text, nullable=False)
    priority                  = Column(Text, nullable=False, default="normal")
    status                    = Column(Text, nullable=False, default="open")
    estimated_completion_date = Column(Date)
    actual_completion_date    = Column(Date)
    notes                     = Column(Text)
    created_at                = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    unit     = relationship("Unit", back_populates="maintenance_requests")
    tenant   = relationship("Tenant", back_populates="maintenance_requests")
    vendor   = relationship("Vendor", back_populates="maintenance_requests")
    invoices = relationship("Invoice", back_populates="request")


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (
        CheckConstraint("record_id IS NOT NULL OR request_id IS NOT NULL", name="chk_invoice_linked"),
        {"schema": "rental"},
    )

    invoice_id     = Column(Integer, primary_key=True)
    vendor_id      = Column(Integer, ForeignKey("rental.vendors.vendor_id"), nullable=False)
    record_id      = Column(Integer, ForeignKey("rental.maintenance_records.record_id"))
    request_id     = Column(Integer, ForeignKey("rental.maintenance_requests.request_id"))
    invoice_number = Column(Text)
    invoice_date   = Column(Date)
    amount         = Column(Numeric(10, 2), nullable=False)
    drive_url      = Column(Text)
    notes          = Column(Text)
    created_at     = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    vendor  = relationship("Vendor", back_populates="invoices")
    record  = relationship("MaintenanceRecord", back_populates="invoices")
    request = relationship("MaintenanceRequest", back_populates="invoices")
