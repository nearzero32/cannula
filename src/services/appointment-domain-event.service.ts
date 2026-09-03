export interface AppointmentDomainEvent { type: string; appointmentId: string; occurredAt: string; data?: Record<string, unknown> }
type Listener = (event: AppointmentDomainEvent) => void | Promise<void>;
export class AppointmentDomainEventService {
    private listeners = new Set<Listener>();
    subscribe(listener: Listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    async publish(event: AppointmentDomainEvent) { await Promise.allSettled([...this.listeners].map(listener => listener(event))); }
}
export default new AppointmentDomainEventService();
