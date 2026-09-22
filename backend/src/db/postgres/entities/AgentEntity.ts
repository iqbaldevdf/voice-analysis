import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "agents" })
@Index("idx_agents_name", ["name"])
@Index("idx_agents_last_call_at", ["lastCallAt"])
export class AgentEntity {
  @PrimaryColumn({ name: "agent_id", type: "text" })
  agentId!: string;

  @Column({ name: "freshcaller_agent_id", type: "integer", nullable: true })
  freshcallerAgentId!: number | null;

  @Column({ type: "text" })
  name!: string;

  @Column({ name: "team_name", type: "text", nullable: true })
  teamName!: string | null;

  @Column({ name: "call_count", type: "integer", default: 0 })
  callCount!: number;

  @Column({ name: "recording_count", type: "integer", default: 0 })
  recordingCount!: number;

  @Column({ name: "analyzed_count", type: "integer", default: 0 })
  analyzedCount!: number;

  @Column({ name: "appointment_count", type: "integer", default: 0 })
  appointmentCount!: number;

  @Column({ name: "average_score", type: "double precision", nullable: true })
  averageScore!: number | null;

  @Column({ name: "first_call_at", type: "timestamptz", nullable: true })
  firstCallAt!: Date | null;

  @Column({ name: "last_call_at", type: "timestamptz", nullable: true })
  lastCallAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
